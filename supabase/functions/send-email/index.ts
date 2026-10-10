import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";
import { APP_URL, button, details, esc, layout, logEmail, para, pill, sendEmail } from "../_shared/email.ts";

const ADMIN_EMAILS_LIST = ["samyabboute5@gmail.com", "contact@docline.health"];
const SUPPORT_REPLY_TO = "contact@docline.health";

// ── CORS dynamique ───────────────────────────────────────────────
function buildCors(req: Request) {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin":  origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Credentials": "true",
  };
}

// ── Auth : décodage JWT local (sans appel API → fiable, rapide) ──
function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad  = b64 + "=".repeat((4 - b64.length % 4) % 4);
    return JSON.parse(atob(pad));
  } catch { return null; }
}

function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 1)  return "moins d'une minute";
  if (mins < 60) return `${mins} minute${mins > 1 ? "s" : ""}`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m.toString().padStart(2, "0")}`;
}

const DOCTOR_REASON = "Vous recevez cet email car vous avez un compte médecin Docline.";

// ════════════════════════════════════════════════════════════════
// MODÈLES — tous construits sur _shared/email.ts (charte graphique v1.0)
// ════════════════════════════════════════════════════════════════

// Modèle générique (modèles stockés en base, emails libres)
function buildBaseEmail(heading: string, content: string, cta?: { text: string; url: string }, badgeLabel?: string): string {
  return layout({
    preheader: content.split("\n").find((l) => l.trim() && !/^bonjour/i.test(l.trim())) ?? heading,
    title: heading,
    body: (badgeLabel ? `<div style="margin-bottom:18px">${pill(badgeLabel, "ok")}</div>` : "")
      + para(content) + (cta ? button(cta.text, cta.url) : ""),
    reason: DOCTOR_REASON,
  });
}

function buildWelcomeEmail(firstName: string): string {
  return layout({
    preheader: "Trois étapes pour accueillir vos premiers patients en ligne.",
    title: `Bienvenue, ${firstName}.`,
    body: para("Votre cabinet Docline est prêt. Pour bien démarrer :\n\n**1.** Renseignez vos horaires de consultation.\n**2.** Ajoutez ou importez vos patients.\n**3.** Partagez votre lien de réservation : vos patients prennent rendez-vous sans appeler.")
      + button("Ouvrir mon cabinet", `${APP_URL}/dashboard`)
      + para("\nUne question ? Répondez simplement à cet email, nous vous répondons sous 24 heures ouvrées."),
    reason: DOCTOR_REASON,
  });
}

function buildMaintenanceActivatedEmail(firstName: string): string {
  return layout({
    preheader: "Une courte maintenance est en cours. Vos données ne sont pas affectées.",
    title: `Bonjour ${firstName},`,
    body: `<div style="margin-bottom:18px">${pill("Maintenance en cours", "wait")}</div>`
      + para("Docline est momentanément en maintenance pour une mise à jour.\n\n**Vos rendez-vous, patients et ordonnances ne sont pas affectés.** Nous vous écrirons dès que le service est rétabli."),
    reason: DOCTOR_REASON,
  });
}

function buildMaintenanceResumeEmail(firstName: string, duration?: string): string {
  return layout({
    preheader: "Docline est de nouveau entièrement disponible.",
    title: `Bonjour ${firstName},`,
    body: `<div style="margin-bottom:18px">${pill("Service rétabli", "ok")}</div>`
      + para(`La maintenance est terminée : Docline est de nouveau entièrement disponible.${duration ? `\n\nElle a duré **${duration}**.` : ""}\n\nMerci pour votre patience.`)
      + button("Ouvrir mon cabinet", `${APP_URL}/dashboard`),
    reason: DOCTOR_REASON,
  });
}

function buildOccasionEmail(title: string, text: string, preheader: string): string {
  return layout({ preheader, title, body: para(text) + para("\nL'équipe Docline"), reason: DOCTOR_REASON });
}
const buildEidAlFitrEmail = (fn: string) => buildOccasionEmail(`Eid Moubarak, ${fn}.`,
  "Toute l'équipe Docline vous souhaite un joyeux Eid el-Fitr, entouré de vos proches.", "Nos meilleurs vœux pour l'Aïd.");
const buildEidAlAdhaEmail = (fn: string) => buildOccasionEmail(`Eid Moubarak, ${fn}.`,
  "Toute l'équipe Docline vous souhaite un Eid el-Adha béni, en famille, dans la joie et la santé.", "Nos meilleurs vœux pour l'Aïd.");
const buildRamadanEmail = (fn: string) => buildOccasionEmail(`Ramadan Kareem, ${fn}.`,
  "Toute l'équipe Docline vous souhaite un mois de Ramadan serein, plein de santé et de bénédictions.", "Nos meilleurs vœux pour le mois de Ramadan.");

function buildNewsletterEmail(_subject: string, heading: string, body: string, cta?: { text: string; url: string }): string {
  return layout({
    preheader: body.split("\n")[0].slice(0, 120),
    title: heading,
    body: para(body) + (cta?.text && cta?.url ? button(cta.text, cta.url) : ""),
    reason: DOCTOR_REASON,
  });
}

// Facture envoyée par un médecin à son patient
function buildInvoiceEmail(inv: any, from: string): string {
  const money = (n: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0) + " DA";
  const items = Array.isArray(inv.items) && inv.items.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px">
        ${inv.items.map((it: any) => `<tr>
          <td style="padding:10px 0;border-bottom:1px solid #ECE8F4;font-family:Inter,Arial,sans-serif;font-size:14px;color:#3B3551">${esc(it.description || "—")}${(it.quantity || 1) > 1 ? ` × ${esc(it.quantity)}` : ""}</td>
          <td style="padding:10px 0;border-bottom:1px solid #ECE8F4;font-family:Inter,Arial,sans-serif;font-size:14px;color:#0D0520;font-weight:600;text-align:right">${money((it.unit_price || 0) * (it.quantity || 1))}</td>
        </tr>`).join("")}
      </table>` : "";
  return layout({
    preheader: `Facture ${inv.invoice_number} · ${money(inv.total)}`,
    title: `Facture ${inv.invoice_number}`,
    body: para(`Bonjour ${inv.client_name || ""},\n\nVoici votre facture de **${from}**.`)
      + details([["Numéro", inv.invoice_number], ["Date d'émission", inv.issue_date], ["Échéance", inv.due_date]])
      + items
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 6px;background:#4C1D95;border-radius:16px">
          <tr><td style="padding:16px 20px;font-family:Inter,Arial,sans-serif;font-size:14px;color:rgba(255,255,255,.8)">Total TTC</td>
              <td style="padding:16px 20px;font-family:Inter,Arial,sans-serif;font-size:22px;font-weight:800;color:#FFFFFF;text-align:right">${money(inv.total)}</td></tr>
        </table>`
      + (inv.notes ? para(`\n**Note :** ${inv.notes}`) : "")
      + para(`\nPour toute question sur cette facture, répondez à cet email : votre message est transmis à ${from}.`),
    reason: `Facture envoyée par ${from} via Docline.`,
  });
}

// ════════════════════════════════════════════════════════════════
// REQUEST HANDLER
// ════════════════════════════════════════════════════════════════
serve(async (req) => {
  const CORS = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
  if (!jwt) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });

  // ── Valider le JWT localement (plus fiable que getUser() API call) ──
  const claims = decodeJwt(jwt);
  if (!claims) {
    return new Response(JSON.stringify({ error: "Unauthorized", detail: "invalid jwt" }), { status: 401, headers: CORS });
  }
  const exp = typeof claims.exp === "number" ? claims.exp : 0;
  if (exp && Math.floor(Date.now() / 1000) > exp) {
    return new Response(JSON.stringify({ error: "Unauthorized", detail: "jwt expired" }), { status: 401, headers: CORS });
  }
  const userEmail: string = ((claims.email ?? (claims as any).user_metadata?.email ?? "") as string).toLowerCase();
  const userId:    string = (claims.sub as string) ?? "";
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized", detail: "no sub" }), { status: 401, headers: CORS });
  }

  // ── Supabase client (pour les requêtes DB) ──
  const apiKey  = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supaUrl = Deno.env.get("SUPABASE_URL") ?? "https://ferkzwzypmdtuypxribz.supabase.co";
  const supabase = createClient(supaUrl, apiKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });

  const body   = await req.json();
  const { type, payload } = body;

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, email, welcome_email_sent")
    .eq("id", userId)
    .single();

  const firstName  = profile?.first_name ?? "Docteur";
  const senderName = `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || "Docline";

  const vars: Record<string, string> = {
    first_name:     firstName,
    sender_name:    senderName,
    app_url:        APP_URL,
    invoice_number: payload?.invoice_number ?? "",
  };

  let ok = false;

  // ── Invoice ──────────────────────────────────────────────────
  if (type === "invoice") {
    if (!payload?.client_email) {
      return new Response(JSON.stringify({ error: "client_email required" }), { status: 400, headers: CORS });
    }
    const { data: sub } = await supabase.from("subscriptions").select("plan,status").eq("user_id", userId).single();
    const onTrial = (await supabase.rpc("is_on_trial")).data;
    if (!sub || (sub.plan === "free" && !onTrial)) {
      return new Response(JSON.stringify({ error: "Active Pro subscription required" }), { status: 403, headers: CORS });
    }
    const html    = buildInvoiceEmail(payload, senderName);
    const subject = `Facture ${payload.invoice_number} — ${senderName}`;
    ok = await sendEmail(payload.client_email, subject, html, profile?.email);
    await logEmail({ type, to: payload.client_email, name: payload.client_name, subject, status: ok ? "sent" : "failed", triggeredBy: userEmail, metadata: { invoice_number: payload.invoice_number } });
    return new Response(JSON.stringify({ success: ok }), { status: ok ? 200 : 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  // ── maintenance_activated ────────────────────────────────────
  if (type === "maintenance_activated") {
    if (!ADMIN_EMAILS_LIST.includes(userEmail)) {
      return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: CORS });
    }
    // ── Mode test : envoyer à une adresse précise ────────────────
    if (payload?.to) {
      const fn  = String(payload.firstName || "Docteur");
      const sub = "Maintenance en cours — Votre accès est préservé";
      const ok  = await sendEmail(String(payload.to), sub, buildMaintenanceActivatedEmail(fn));
      await logEmail({ type, to: String(payload.to), name: fn, subject: sub, status: ok ? "sent" : "failed", triggeredBy: userEmail });
      return new Response(JSON.stringify({ success: ok, sent: ok ? 1 : 0 }), { status: ok ? 200 : 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: doctors, error: e } = await admin.from("profiles").select("first_name, last_name, email").not("email", "is", null);
    if (e) return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    const list = (doctors ?? []).filter((d: any) => d.email);
    let sent = 0, failed = 0;
    for (const doc of list) {
      const pn      = doc.first_name || "Docteur";
      const subject = "Maintenance en cours — Votre accès est préservé";
      const html    = buildMaintenanceActivatedEmail(pn);
      const mailOk  = await sendEmail(doc.email, subject, html);
      await logEmail({ type: "maintenance_activated", to: doc.email, name: `${pn} ${doc.last_name ?? ""}`.trim(), subject, status: mailOk ? "sent" : "failed", triggeredBy: userEmail });
      if (mailOk) sent++; else failed++;
    }
    return new Response(JSON.stringify({ sent, failed, total: list.length }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  // ── maintenance_resume ───────────────────────────────────────
  if (type === "maintenance_resume") {
    if (!ADMIN_EMAILS_LIST.includes(userEmail)) {
      return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: CORS });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // ── Mode test : envoyer à une adresse précise ────────────────
    if (payload?.to) {
      const fn  = String(payload.firstName || "Docteur");
      const sub = "La plateforme Docline est de retour";
      const ok  = await sendEmail(String(payload.to), sub, buildMaintenanceResumeEmail(fn));
      await logEmail({ type, to: String(payload.to), name: fn, subject: sub, status: ok ? "sent" : "failed", triggeredBy: userEmail });
      return new Response(JSON.stringify({ success: ok, sent: ok ? 1 : 0 }), { status: ok ? 200 : 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // ── Durée de la maintenance ──────────────────────────────────
    let duration: string | undefined;
    try {
      const { data: startRow } = await admin
        .from("app_settings").select("value").eq("key", "maintenance_started_at").single();
      if (startRow?.value) {
        const startMs = new Date(String(startRow.value).replace(/^"|"$/g, "")).getTime();
        if (!isNaN(startMs)) duration = formatDuration(Date.now() - startMs);
      }
    } catch (_) {}

    // ── Récupérer TOUS les médecins (profiles) ───────────────────
    const { data: doctors } = await admin
      .from("profiles").select("first_name, last_name, email").not("email", "is", null);

    // ── Récupérer les inscrits maintenance_notify ─────────────────
    const { data: subs } = await admin
      .from("maintenance_notify").select("prenom, nom, email");

    // ── Fusionner et dédupliquer par email ────────────────────────
    const seen = new Set<string>();
    const list: Array<{ firstName: string; name: string; email: string }> = [];
    for (const d of (doctors ?? [])) {
      if (!d.email || seen.has(d.email.toLowerCase())) continue;
      seen.add(d.email.toLowerCase());
      list.push({ firstName: d.first_name || "Docteur", name: `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim(), email: d.email });
    }
    for (const s of (subs ?? [])) {
      if (!s.email || seen.has(s.email.toLowerCase())) continue;
      seen.add(s.email.toLowerCase());
      list.push({ firstName: s.prenom || "", name: `${s.prenom ?? ""} ${s.nom ?? ""}`.trim(), email: s.email });
    }

    let sent = 0, failed = 0;
    for (const rec of list) {
      const subject = "La plateforme Docline est de retour";
      const html    = buildMaintenanceResumeEmail(rec.firstName, duration);
      const mailOk  = await sendEmail(rec.email, subject, html);
      await logEmail({ type: "maintenance_resume", to: rec.email, name: rec.name, subject, status: mailOk ? "sent" : "failed", triggeredBy: userEmail });
      if (mailOk) sent++; else failed++;
    }

    // Purger la liste notify (médecins déjà notifiés via profiles)
    await admin.from("maintenance_notify").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    return new Response(JSON.stringify({ sent, failed, total: list.length, duration }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }

  // ── Occasions spéciales & Newsletter ────────────────────────
  if (["eid_alfitr", "eid_aladha", "ramadan", "newsletter"].includes(type)) {
    if (!ADMIN_EMAILS_LIST.includes(userEmail)) {
      return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: CORS });
    }

    function occasionEmail(fn: string): { html: string; subject: string } {
      if (type === "eid_alfitr")  return { html: buildEidAlFitrEmail(fn),  subject: "Eid Moubarak — De la part de Docline" };
      if (type === "eid_aladha")  return { html: buildEidAlAdhaEmail(fn),  subject: "Eid Moubarak — De la part de Docline" };
      if (type === "ramadan")     return { html: buildRamadanEmail(fn),     subject: "Ramadan Kareem — De la part de Docline" };
      // newsletter
      return {
        html:    buildNewsletterEmail(payload?.subject || "Actualités Docline", payload?.heading || "Les actualités Docline.", payload?.body || "Retrouvez ici les dernières nouveautés de la plateforme.", payload?.cta),
        subject: payload?.subject || "Actualités Docline",
      };
    }

    // Mode test : une seule adresse
    if (payload?.to && !payload?.broadcast) {
      const fn = String(payload.firstName || "Docteur");
      const { html, subject } = occasionEmail(fn);
      const ok = await sendEmail(String(payload.to), subject, html);
      await logEmail({ type, to: String(payload.to), name: fn, subject, status: ok ? "sent" : "failed", triggeredBy: userEmail });
      return new Response(JSON.stringify({ success: ok, sent: ok ? 1 : 0 }), { status: ok ? 200 : 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Mode diffusion : tous les médecins
    if (payload?.broadcast) {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: doctors } = await admin.from("profiles").select("first_name, last_name, email").not("email", "is", null);
      const list = (doctors ?? []).filter((d: any) => d.email);
      let sent = 0, failed = 0;
      for (const doc of list) {
        const fn = doc.first_name || "Docteur";
        const { html, subject } = occasionEmail(fn);
        const ok = await sendEmail(doc.email, subject, html);
        await logEmail({ type, to: doc.email, name: `${doc.first_name ?? ""} ${doc.last_name ?? ""}`.trim(), subject, status: ok ? "sent" : "failed", triggeredBy: userEmail });
        if (ok) sent++; else failed++;
      }
      return new Response(JSON.stringify({ sent, failed, total: list.length }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Specify payload.to or payload.broadcast:true" }), { status: 400, headers: CORS });
  }

  // ── Email libre rédigé dans Symphony (CRM, hub) — réservé à l'équipe ──
  // Accepte { type: "admin_custom", payload: { to, subject, html } } ou l'ancien format { to, subject, html }.
  const custom = type === "admin_custom" ? payload : (!type && body?.subject && body?.html ? body : null);
  if (custom) {
    const { data: isStaff } = await supabase.rpc("symphony_is_staff");
    if (isStaff !== true) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: CORS });
    }
    const to = String(custom.to ?? "").trim();
    const subject = String(custom.subject ?? "").trim().slice(0, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || !subject || !custom.html) {
      return new Response(JSON.stringify({ error: "to, subject et html requis" }), { status: 400, headers: CORS });
    }
    // Contenu rédigé par l'équipe dans Symphony : HTML de confiance (accès réservé au staff)
    const html = layout({ preheader: subject, title: subject, body: `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3B3551">${String(custom.html)}</div>`, reason: "Message de l'équipe Docline." });
    ok = await sendEmail(to, subject, html, SUPPORT_REPLY_TO);
    await logEmail({ type: "admin_custom", to, subject, status: ok ? "sent" : "failed", triggeredBy: userEmail });
    return new Response(JSON.stringify({ success: ok }), { status: ok ? 200 : 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  // ── Templates DB (welcome, trial_granted, etc.) ──────────────
  if (type === "welcome" && profile?.welcome_email_sent && !payload?.force) {
    return new Response(JSON.stringify({ success: true, skipped: true }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const { data: tmpl } = await supabase.from("email_templates").select("*").eq("id", type).single();
  if (!tmpl || !tmpl.active) {
    return new Response(JSON.stringify({ error: "Template not found or inactive" }), { status: 404, headers: CORS });
  }

  // Envoyer un modèle à quelqu'un d'autre que soi est réservé à l'équipe
  if (payload?.to && String(payload.to).toLowerCase() !== String(userEmail ?? "").toLowerCase()) {
    const { data: isStaff } = await supabase.rpc("symphony_is_staff");
    if (isStaff !== true) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: CORS });
    vars.first_name = String(payload.first_name ?? "Docteur");
  }

  const subject = interpolate(tmpl.subject, vars);
  const heading = interpolate(tmpl.heading, vars);
  const intro   = interpolate(tmpl.intro_text, vars);
  const cta     = tmpl.cta_text ? { text: tmpl.cta_text, url: interpolate(tmpl.cta_url ?? APP_URL, vars) } : undefined;

  // Welcome → template dédié avec meilleur rendu
  let html: string;
  if (type === "welcome") {
    html = buildWelcomeEmail(firstName);
  } else {
    const badges: Record<string, string | undefined> = {
      trial_granted:     "Accès Pro activé",
      trial_expiring:    undefined,
      payment_confirmed: "Paiement reçu",
      contact_autoreply: undefined,
    };
    html = buildBaseEmail(heading, intro, cta, badges[type]);
  }

  const recipient = payload?.to ?? userEmail;
  ok = await sendEmail(recipient, subject, html, SUPPORT_REPLY_TO);
  await logEmail({ type, to: recipient, name: firstName, subject, status: ok ? "sent" : "failed", triggeredBy: userEmail });

  if (type === "welcome" && ok) {
    await supabase.from("profiles").update({ welcome_email_sent: true }).eq("id", userId);
  }

  return new Response(JSON.stringify({ success: ok }), {
    status: ok ? 200 : 500,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
