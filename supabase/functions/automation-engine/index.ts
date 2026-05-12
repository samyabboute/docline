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

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Docline <noreply@docline.health>', to: [to], subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[automation] sendEmail failed:', err);
  }
  return res.ok;
}

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
        vat_rate:       p.tva_rate    ?? 20,
        vat_amount:     vatAmount,
        total:          p.amount_ttc  ?? 0,
        currency:       p.currency    ?? 'EUR',
        status:         'sent',
        issue_date:     new Date().toISOString().slice(0, 10),
        due_date:       due.toISOString().slice(0, 10),
        notes:          'Auto-generated from signed Smart File',
        line_items:     p.line_items  ?? [],
      }).select().single();

      if (iE) throw iE;

      await sendEmail(
        p.client_email,
        `Invoice from ${p.project_title}`,
        `<div style="font-family:sans-serif;max-width:560px;margin:0 auto"><h2 style="color:#003399">Invoice ready</h2><p>Hi ${p.client_name},</p><p>Invoice for <strong>${p.project_title}</strong>: <strong>€${p.amount_ttc?.toFixed(2)}</strong> due ${due.toLocaleDateString('fr-FR')}.</p></div>`,
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
          `Payment reminder — ${inv.invoice_number ?? inv.id.slice(0, 8)}`,
          `<div style="font-family:sans-serif;max-width:560px"><h2 style="color:#DC2626">Payment reminder</h2><p>Hi ${inv.client_name},</p><p>Invoice <strong>${inv.invoice_number ?? ''}</strong> for <strong>€${inv.total?.toFixed(2)}</strong> is ${days} days overdue.</p></div>`,
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
