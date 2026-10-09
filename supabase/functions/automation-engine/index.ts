// ============================================================
// PROSPEO — Automation Engine
// Supabase Edge Function: supabase/functions/automation-engine/index.ts
// Deploy: supabase functions deploy automation-engine
//
// SECURITY:
// - Requires x-automation-secret header matching AUTOMATION_SECRET env var
// - Uses service role key for all DB operations
// - All invoice inserts use correct schema column names
//
// Secrets needed:
//   supabase secrets set AUTOMATION_SECRET=<random-strong-secret>
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { captureException } from "../_shared/sentry.ts";
import { details, layout, para, sendEmail } from "../_shared/email.ts";

const DA = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n || 0) + " DA";

const SUPA_URL   = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const ORIGIN     = Deno.env.get('ALLOWED_ORIGIN') ?? '*';
const AUTOMATION_SECRET = Deno.env.get('AUTOMATION_SECRET');

const cors = {
  'Access-Control-Allow-Origin':  ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-automation-secret',
  'Content-Type': 'application/json',
};


serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Internal secret check — prevents external abuse of this endpoint
  if (AUTOMATION_SECRET) {
    const secret = req.headers.get('x-automation-secret');
    if (secret !== AUTOMATION_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: cors });
    }
  }

  try {
    const { trigger, payload } = await req.json();
    const supa = createClient(SUPA_URL, SUPA_KEY);

    // ── TRIGGER: proposal.signed ──────────────────────────────
    if (trigger === 'proposal.signed') {
      const { proposal_id } = payload;
      const { data: p, error: pE } = await supa.from('proposals').select('*').eq('id', proposal_id).single();
      if (pE || !p) throw new Error('Proposal not found');

      // Idempotency: skip if invoice already created for this proposal
      const { data: ex } = await supa.from('invoices').select('id').eq('proposal_id', proposal_id).maybeSingle();
      if (ex) return new Response(JSON.stringify({ ok: true, action: 'invoice_exists' }), { headers: cors });

      const due = new Date();
      due.setDate(due.getDate() + 30);

      // vat_amount = amount_ttc - amount_ht
      const vatAmount = (p.amount_ttc ?? 0) - (p.amount_ht ?? 0);

      const { data: inv, error: iE } = await supa.from('invoices').insert({
        user_id:        p.user_id,
        proposal_id:    proposal_id,
        invoice_number: 'INV-' + Date.now().toString().slice(-6),
        client_name:    p.client_name,
        client_email:   p.client_email,
        type:           'invoice',
        subtotal:       p.amount_ht   ?? 0,
        vat_rate:       p.tva_rate    ?? 19,
        vat_amount:     vatAmount,
        total:          p.amount_ttc  ?? 0,
        currency:       p.currency    ?? 'DZD',
        status:         'sent',
        issue_date:     new Date().toISOString().slice(0, 10),
        due_date:       due.toISOString().slice(0, 10),
        notes:          'Facture générée automatiquement après signature du devis',
        line_items:     p.line_items  ?? [],
      }).select().single();

      if (iE) throw iE;

      await sendEmail(
        p.client_email,
        `Votre facture · ${p.project_title}`,
        layout({
          preheader: `Montant : ${DA(p.amount_ttc)}, échéance le ${due.toLocaleDateString('fr-FR')}`,
          title: 'Votre facture est prête',
          body: para(`Bonjour ${p.client_name || ''},\n\nVotre devis **${p.project_title}** a été signé : voici la facture correspondante.`)
            + details([['Montant TTC', DA(p.amount_ttc)], ['Échéance', due.toLocaleDateString('fr-FR')]]),
          reason: 'Facture envoyée via Docline.',
        }),
      );

      await supa.from('audit_log').insert({
        user_id:  p.user_id,
        event:    'automation.invoice_created',
        metadata: { proposal_id, invoice_id: inv.id },
      });

      return new Response(JSON.stringify({ ok: true, action: 'invoice_created', invoice_id: inv.id }), { headers: cors });
    }

    // ── TRIGGER: invoice.overdue_check ───────────────────────
    if (trigger === 'invoice.overdue_check') {
      const today = new Date().toISOString().slice(0, 10);
      const { data: overdue } = await supa.from('invoices').select('*').eq('status', 'sent').lt('due_date', today);
      let count = 0;

      for (const inv of (overdue ?? [])) {
        // Skip if a reminder was already sent in the last 7 days
        const { data: last } = await supa
          .from('payment_reminders')
          .select('sent_at')
          .eq('invoice_id', inv.id)
          .eq('type', 'overdue_7')
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (last && (Date.now() - new Date(last.sent_at).getTime()) / 86400000 < 7) continue;

        const days = Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000);

        await sendEmail(
          inv.client_email,
          `Rappel de paiement · facture ${inv.invoice_number ?? inv.id.slice(0, 8)}`,
          layout({
            preheader: `Facture échue depuis ${days} jour${days > 1 ? 's' : ''}`,
            title: 'Petit rappel de paiement',
            body: para(`Bonjour ${inv.client_name || ''},\n\nSauf erreur de notre part, la facture ci-dessous reste à régler. Si le paiement a déjà été fait, merci de ne pas tenir compte de ce message.`)
              + details([['Facture', inv.invoice_number ?? ''], ['Montant TTC', DA(inv.total)], ['Retard', `${days} jour${days > 1 ? 's' : ''}`]]),
            reason: 'Rappel envoyé via Docline.',
          }),
        );

        await supa.from('payment_reminders').insert({
          invoice_id: inv.id,
          user_id:    inv.user_id,
          type:       'overdue_7',
          sent_at:    new Date().toISOString(),
        });
        count++;
      }

      return new Response(JSON.stringify({ ok: true, count }), { headers: cors });
    }

    return new Response(JSON.stringify({ ok: false, error: 'Unknown trigger' }), { status: 400, headers: cors });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[automation] error:', message);
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: cors });
  }
});
