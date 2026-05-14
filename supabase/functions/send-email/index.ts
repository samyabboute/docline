import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";

const RESEND_KEY = Deno.env.get("RESEND_API_KEY")!;
const APP_URL = Deno.env.get("APP_URL") ?? "https://docline.health";
const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Brand palette ─────────────────────────────────────────────
const BRAND      = "#3B1772";
const BRAND_DARK = "#2D1259";
const BRAND_MID  = "#5B2DB0";

// ── Docline logo — version blanche hébergée sur GitHub Pages ──
// viewBox="0 0 1000 187.3" → ratio ~5.34:1 → à 180px de large → ~34px de haut
const LOGO_BASE_URL = "https://samyabboute.github.io/docline";
const LOGO_HTML = `<img src="${LOGO_BASE_URL}/docline-logo-white.svg" alt="Docline" width="180" height="34" style="display:block;margin:0 auto 8px;border:0" />`;

// ── Helpers ───────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string, replyTo?: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Docline <noreply@docline.health>", to: [to], subject, html, reply_to: replyTo }),
  });
  return res.ok;
}

function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

// ── Base email template ───────────────────────────────────────
function buildBaseEmail(heading: string, content: string, cta?: { text: string; url: string }, badgeLabel?: string): string {
  const badgeHtml = badgeLabel
    ? `<div style="display:inline-block;background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.85);font-size:10px;font-weight:700;padding:4px 12px;border-radius:999px;letter-spacing:0.6px;margin-top:14px;border:1px solid rgba(255,255,255,0.2)">${badgeLabel}</div>`
    : "";

  const ctaHtml = cta
    ? `<div style="text-align:center;margin:32px 0">
        <a href="${cta.url}" style="display:inline-block;background:${BRAND};color:#fff;font-weight:700;padding:15px 36px;border-radius:10px;text-decoration:none;font-size:14px;letter-spacing:0.2px;box-shadow:0 4px 18px rgba(59,23,114,0.35)">${cta.text}</a>
       </div>`
    : "";

  const paragraphs = content.split(/\n\n/).map(p =>
    `<p style="margin:0 0 16px;color:#3D3352;font-size:14px;line-height:1.75">${p.replace(/\n/g, "<br>")}</p>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:#F3EFF9;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3EFF9;padding:40px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">

<!-- Header -->
<tr>
  <td style="background:linear-gradient(150deg,${BRAND_DARK} 0%,${BRAND} 55%,${BRAND_MID} 100%);border-radius:16px 16px 0 0;padding:36px 48px;text-align:center">
    ${LOGO_HTML}
    ${badgeHtml}
  </td>
</tr>

<!-- Body -->
<tr>
  <td style="background:#fff;padding:40px 48px;border-left:1px solid #E4D9F7;border-right:1px solid #E4D9F7">
    <h1 style="margin:0 0 24px;font-size:20px;font-weight:800;color:#1A0E2E;line-height:1.35;letter-spacing:-0.3px">${heading}</h1>
    ${paragraphs}
    ${ctaHtml}
    <hr style="border:none;border-top:1px solid #EDE5FA;margin:28px 0">
    <p style="margin:0;font-size:12px;color:#9B8CB8;line-height:1.6">
      Cordialement,<br>
      <strong style="color:#4A3570">L'equipe Docline</strong><br>
      <a href="https://docline.health" style="color:${BRAND};text-decoration:none">docline.health</a>
    </p>
  </td>
</tr>

<!-- Footer -->
<tr>
  <td style="background:#EDE5FA;border-radius:0 0 16px 16px;border:1px solid #E4D9F7;border-top:none;padding:20px 48px;text-align:center">
    <p style="margin:0;font-size:11px;color:#9B8CB8;line-height:1.7">
      Donnees hebergees en Europe · Conforme RGPD · ISO 27001<br>
      Docline · <a href="https://docline.health" style="color:#9B8CB8;text-decoration:underline">docline.health</a>
      &nbsp;·&nbsp; <a href="https://docline.health/privacy" style="color:#9B8CB8;text-decoration:underline">Politique de confidentialite</a>
    </p>
  </td>
</tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Invoice email template ────────────────────────────────────
function buildInvoiceEmail(inv: any, from: string): string {
  const total = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(inv.total || 0);
  const itemsHtml = Array.isArray(inv.items) && inv.items.length
    ? inv.items.map((it: any) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #EDE5FA;color:#3D3352;font-size:13px">${it.description || "-"}</td>
          <td style="padding:10px 0;border-bottom:1px solid #EDE5FA;text-align:center;color:#7B6DA0;font-size:13px">${it.quantity || 1}</td>
          <td style="padding:10px 0;border-bottom:1px solid #EDE5FA;text-align:right;font-weight:600;color:#1A0E2E;font-size:13px">${new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(it.unit_price || 0)}</td>
        </tr>`)
      .join("")
    : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Facture ${inv.invoice_number}</title></head>
<body style="margin:0;padding:0;background:#F3EFF9;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3EFF9;padding:40px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">

<!-- Header -->
<tr>
  <td style="background:linear-gradient(150deg,${BRAND_DARK} 0%,${BRAND} 55%,${BRAND_MID} 100%);border-radius:16px 16px 0 0;padding:32px 48px">
    <table width="100%"><tr>
      <td>${LOGO_HTML}</td>
      <td style="text-align:right;vertical-align:middle">
        <div style="color:rgba(255,255,255,0.6);font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:600">Facture</div>
        <div style="color:#fff;font-size:18px;font-weight:800;margin-top:4px">${inv.invoice_number}</div>
      </td>
    </tr></table>
  </td>
</tr>

<!-- Body -->
<tr>
  <td style="background:#fff;padding:40px 48px;border-left:1px solid #E4D9F7;border-right:1px solid #E4D9F7">

    <!-- From / To -->
    <table width="100%" style="margin-bottom:32px"><tr>
      <td style="vertical-align:top">
        <div style="font-size:10px;font-weight:700;color:#9B8CB8;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px">De la part de</div>
        <div style="font-size:14px;font-weight:700;color:#1A0E2E">${from}</div>
      </td>
      <td style="vertical-align:top;text-align:right">
        <div style="font-size:10px;font-weight:700;color:#9B8CB8;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px">Destinataire</div>
        <div style="font-size:14px;font-weight:700;color:#1A0E2E">${inv.client_name || inv.client_email}</div>
      </td>
    </tr></table>

    <!-- Summary -->
    <table width="100%" style="background:#F8F5FF;border-radius:12px;padding:20px;border:1px solid #E4D9F7;margin-bottom:24px">
      <tr>
        <td style="color:#7B6DA0;font-size:12px;padding:5px 0">Numero de facture</td>
        <td style="text-align:right;font-weight:700;color:#1A0E2E;font-size:13px">${inv.invoice_number}</td>
      </tr>
      <tr>
        <td style="color:#7B6DA0;font-size:12px;padding:5px 0">Date d'emission</td>
        <td style="text-align:right;color:#1A0E2E;font-size:13px">${inv.issue_date || "-"}</td>
      </tr>
      <tr>
        <td style="color:#7B6DA0;font-size:12px;padding:5px 0">Date d'echeance</td>
        <td style="text-align:right;color:#1A0E2E;font-size:13px">${inv.due_date || "-"}</td>
      </tr>
    </table>

    <!-- Items -->
    ${itemsHtml ? `
    <table width="100%" style="margin-bottom:20px">
      <tr style="background:#F8F5FF">
        <th style="text-align:left;padding:10px 0;font-size:11px;font-weight:700;color:#7B6DA0;text-transform:uppercase;letter-spacing:0.5px">Description</th>
        <th style="text-align:center;padding:10px 0;font-size:11px;font-weight:700;color:#7B6DA0;text-transform:uppercase;letter-spacing:0.5px">Qte</th>
        <th style="text-align:right;padding:10px 0;font-size:11px;font-weight:700;color:#7B6DA0;text-transform:uppercase;letter-spacing:0.5px">Montant</th>
      </tr>
      ${itemsHtml}
    </table>` : ""}

    <!-- Total -->
    <table width="100%" style="margin-bottom:24px">
      <tr>
        <td style="padding:16px 20px;background:linear-gradient(150deg,${BRAND_DARK},${BRAND});border-radius:10px">
          <table width="100%"><tr>
            <td style="color:rgba(255,255,255,0.7);font-size:13px;font-weight:600">Total TTC</td>
            <td style="text-align:right;color:#fff;font-size:22px;font-weight:900">${total}</td>
          </tr></table>
        </td>
      </tr>
    </table>

    ${inv.notes ? `<div style="padding:16px 20px;background:#FFFAEB;border-left:3px solid #F79009;border-radius:8px;font-size:13px;color:#6B4E00;margin-bottom:24px"><strong>Note :</strong> ${inv.notes}</div>` : ""}

    <hr style="border:none;border-top:1px solid #EDE5FA;margin:24px 0">
    <p style="margin:0;font-size:12px;color:#9B8CB8">
      Envoye par <strong style="color:#4A3570">${from}</strong> via Docline
    </p>
  </td>
</tr>

<!-- Footer -->
<tr>
  <td style="background:#EDE5FA;border-radius:0 0 16px 16px;border:1px solid #E4D9F7;border-top:none;padding:20px 48px;text-align:center">
    <p style="margin:0;font-size:11px;color:#9B8CB8;line-height:1.7">
      Document genere via Docline · Donnees hebergees en Europe · Conforme RGPD
    </p>
  </td>
</tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Request handler ───────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });

  const body = await req.json();
  const { type, payload } = body;

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, email, welcome_email_sent")
    .eq("id", user.id)
    .single();

  const firstName = profile?.first_name ?? "Docteur";
  const senderName = `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || "Docline";

  const vars: Record<string, string> = {
    first_name: firstName,
    sender_name: senderName,
    app_url: APP_URL,
    invoice_number: payload?.invoice_number ?? "",
  };

  let ok = false;

  // ── Invoice (needs Pro plan) ─────────────────────────────────
  if (type === "invoice") {
    if (!payload?.client_email) {
      return new Response(JSON.stringify({ error: "client_email required" }), { status: 400, headers: CORS });
    }
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", user.id)
      .single();
    const onTrial = (await supabase.rpc("is_on_trial")).data;
    if (!sub || (sub.plan === "free" && !onTrial)) {
      return new Response(JSON.stringify({ error: "Active Pro subscription required" }), { status: 403, headers: CORS });
    }
    const html = buildInvoiceEmail(payload, senderName);
    ok = await sendEmail(
      payload.client_email,
      `Facture ${payload.invoice_number} — ${senderName}`,
      html,
      profile?.email
    );
    return new Response(JSON.stringify({ success: ok }), {
      status: ok ? 200 : 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // ── Template-based emails ────────────────────────────────────
  // Welcome: skip if already sent (unless forced)
  if (type === "welcome" && profile?.welcome_email_sent && !payload?.force) {
    return new Response(JSON.stringify({ success: true, skipped: true }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const { data: tmpl } = await supabase
    .from("email_templates")
    .select("*")
    .eq("id", type)
    .single();

  if (!tmpl || !tmpl.active) {
    return new Response(JSON.stringify({ error: "Template not found or inactive" }), { status: 404, headers: CORS });
  }

  const subject = interpolate(tmpl.subject, vars);
  const heading = interpolate(tmpl.heading, vars);
  const introText = interpolate(tmpl.intro_text, vars);
  const cta = tmpl.cta_text
    ? { text: tmpl.cta_text, url: interpolate(tmpl.cta_url ?? APP_URL, vars) }
    : undefined;

  // Badge labels — professional, no emojis
  const badgeMap: Record<string, string | undefined> = {
    welcome:           "Compte active",
    trial_granted:     "Acces Pro offert",
    trial_expiring:    "Essai bientot termine",
    payment_confirmed: "Paiement confirme",
    contact_autoreply: undefined,
  };

  const html = buildBaseEmail(heading, introText, cta, badgeMap[type]);

  // recipient: test target, or the authenticated user's email
  const recipient = payload?.to ?? user.email!;
  ok = await sendEmail(recipient, subject, html);

  // Mark welcome as sent
  if (type === "welcome" && ok) {
    await supabase.from("profiles").update({ welcome_email_sent: true }).eq("id", user.id);
  }

  return new Response(JSON.stringify({ success: ok }), {
    status: ok ? 200 : 500,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
