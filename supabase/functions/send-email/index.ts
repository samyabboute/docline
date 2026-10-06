import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";

const RESEND_KEY = Deno.env.get("RESEND_API_KEY")!;
const APP_URL    = Deno.env.get("APP_URL") ?? "https://docline.health";

// ── Brand ────────────────────────────────────────────────────────
const BRAND      = "#3B1772";
const BRAND_MID  = "#5B21B6";
const ADMIN_EMAILS_LIST = ["samyabboute5@gmail.com", "contact@docline.health"];

// ── Logo Docline ─────────────────────────────────────────────────
// PNG à créer : exporter docline-logo-white.png depuis le fichier SVG source
// SVG supporté par Apple Mail, iOS, Outlook.com — Gmail : affiche alt="Docline"
// Pour Gmail avec logo visible : ajouter docline-logo-white.png dans le projet
const LOGO_PNG = "https://docline.health/docline-logo-white.png"; // PNG (à créer)
const LOGO_SVG = "https://docline.health/docline-logo-white.svg"; // SVG (déployé)

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

// ── Helpers ───────────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string, replyTo?: string): Promise<boolean> {
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

async function logEmail(p: {
  type: string; to: string; name?: string; subject?: string;
  status: "sent" | "failed"; triggeredBy?: string; metadata?: Record<string, unknown>;
}) {
  try {
    const s = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await s.from("email_logs").insert({
      type: p.type, recipient_email: p.to, recipient_name: p.name ?? null,
      subject: p.subject ?? null, status: p.status,
      triggered_by: p.triggeredBy ?? null, metadata: p.metadata ?? {},
    });
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 1)  return "moins d'une minute";
  if (mins < 60) return `${mins} minute${mins > 1 ? "s" : ""}`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${m.toString().padStart(2, "0")}`;
}

// ════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES — Design system Docline
// ════════════════════════════════════════════════════════════════

const FONT = `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif`;

// ── Shell ────────────────────────────────────────────────────────

const emailWrapper = (inner: string) => `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Docline</title>
</head>
<body style="margin:0;padding:0;background:#E8E0F4;${FONT}">
<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:#E8E0F4;padding:40px 16px">
  <tr><td align="center">
    <table width="580" cellpadding="0" cellspacing="0" border="0"
           style="max-width:580px;width:100%;border-radius:12px;
                  box-shadow:0 4px 32px rgba(20,5,60,.16)">
      ${inner}
    </table>
  </td></tr>
</table>
</body></html>`;

// ── Header : wordmark texte — 100% compatible tous clients mail ──
const emailHeader = (badgeText?: string) => `
<tr>
  <td style="background:linear-gradient(145deg,#140533 0%,#2E0F60 40%,#5118A8 100%);
             border-radius:12px 12px 0 0;padding:40px 48px 36px;text-align:center">
    <a href="${APP_URL}" style="text-decoration:none;border:0;display:inline-block">
      <span style="display:inline-block;${FONT}">
        <span style="font-size:28px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;line-height:1">doc</span><span style="font-size:28px;font-weight:800;color:#A78BFA;letter-spacing:-0.5px;line-height:1">line</span>
        <span style="display:inline-block;width:7px;height:7px;background:#A78BFA;border-radius:50%;margin-left:2px;vertical-align:middle;position:relative;top:-3px"></span>
      </span>
    </a>
    ${badgeText ? `
    <div style="display:inline-block;margin-top:18px;
                background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);
                border-radius:4px;padding:5px 14px;
                color:rgba(255,255,255,.85);font-size:10px;font-weight:700;
                letter-spacing:1.2px;text-transform:uppercase;${FONT}">${badgeText}</div>` : ""}
  </td>
</tr>`;

// ── Footer ───────────────────────────────────────────────────────
const emailFooter = () => `
<tr>
  <td style="background:#F4F1FA;border:1px solid #DDD5ED;border-top:none;
             border-radius:0 0 12px 12px;padding:20px 48px;text-align:center">
    <p style="margin:0;font-size:11px;color:#9B8CB8;line-height:2;${FONT}">
      <a href="${APP_URL}" style="color:#6D28D9;font-weight:600;text-decoration:none">docline.health</a>
      &nbsp;&middot;&nbsp;
      <a href="${APP_URL}/privacy" style="color:#9B8CB8;text-decoration:none">Confidentialité</a>
      &nbsp;&middot;&nbsp;
      <a href="mailto:contact@docline.health" style="color:#9B8CB8;text-decoration:none">contact@docline.health</a>
      <br>Données hébergées en Europe &nbsp;&middot;&nbsp; Conforme RGPD
    </p>
  </td>
</tr>`;

// ── Corps principal ───────────────────────────────────────────────
function bodyRow(content: string) {
  return `<tr>
  <td style="background:#ffffff;padding:40px 48px 36px;
             border-left:1px solid #DDD5ED;border-right:1px solid #DDD5ED">
    ${content}
  </td>
</tr>`;
}

// ── Typographie ───────────────────────────────────────────────────
function h1(text: string) {
  return `<h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0F0520;
                     line-height:1.3;letter-spacing:-.3px;${FONT}">${text}</h1>`;
}

function p(text: string) {
  return text.split(/\n\n/).map(t =>
    `<p style="margin:0 0 14px;color:#3A2E56;font-size:15px;line-height:1.75;${FONT}">` +
    t.replace(/\n/g, "<br>")
     .replace(/\*\*(.+?)\*\*/g, `<strong style="color:#0F0520">$1</strong>`) +
    `</p>`
  ).join("");
}

// ── Bouton CTA ────────────────────────────────────────────────────
const ctaButton = (text: string, url: string) =>
  `<div style="text-align:left;margin:28px 0 24px">
    <a href="${url}"
       style="display:inline-block;background:#3B1772;
              color:#ffffff;font-weight:600;padding:13px 32px;border-radius:6px;
              text-decoration:none;font-size:14px;letter-spacing:.1px;${FONT}">${text}</a>
  </div>`;

// ── Signature Docline ─────────────────────────────────────────────
function signOff() {
  return `<div style="margin-top:28px;padding-top:20px;border-top:1px solid #EAE2F4">
    <p style="margin:0;font-size:13px;color:#0F0520;font-weight:600;${FONT}">Docline</p>
  </div>`;
}

// ── Badge statut (point coloré + label, sans icône) ───────────────
function statusBadge(label: string, color: { bg: string; border: string; dot: string; text: string }) {
  return `<div style="margin-bottom:28px">
    <span style="display:inline-flex;align-items:center;gap:7px;
                 padding:8px 16px;background:${color.bg};
                 border:1px solid ${color.border};border-radius:6px">
      <span style="width:7px;height:7px;border-radius:50%;
                   background:${color.dot};display:inline-block"></span>
      <span style="font-size:11px;font-weight:700;color:${color.text};
                   letter-spacing:.7px;text-transform:uppercase;${FONT}">${label}</span>
    </span>
  </div>`;
}

// ── buildBaseEmail — template universel ──────────────────────────
function buildBaseEmail(
  heading: string, content: string,
  cta?: { text: string; url: string },
  badgeLabel?: string
): string {
  return emailWrapper(
    emailHeader(badgeLabel) +
    bodyRow(h1(heading) + p(content) + (cta ? ctaButton(cta.text, cta.url) : "") + signOff()) +
    emailFooter()
  );
}

// ════════════════════════════════════════════════════════════════
// TEMPLATES TRANSACTIONNELS
// ════════════════════════════════════════════════════════════════

// ── Bienvenue ────────────────────────────────────────────────────
function buildWelcomeEmail(firstName: string): string {
  return emailWrapper(
    emailHeader("Compte activé") +
    bodyRow(
      h1(`Bienvenue, ${firstName}.`) +
      p(`Votre compte Docline est actif.

Gérez vos rendez-vous, patients, ordonnances et factures depuis votre tableau de bord.`) +
      ctaButton("Accéder à mon espace", APP_URL) +
      `<table width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px">
        <tr>
          <td style="background:#F5F0FC;padding:14px 18px;border-radius:6px;
                     border-left:3px solid #6D28D9">
            <p style="margin:0;font-size:13px;color:#4A3D72;line-height:1.65;${FONT}">
              Une question ? Contactez-nous à
              <a href="mailto:contact@docline.health"
                 style="color:#5B21B6;text-decoration:none;font-weight:600">contact@docline.health</a>
            </p>
          </td>
        </tr>
      </table>` +
      signOff()
    ) +
    emailFooter()
  );
}

// ── Maintenance activée (tous les médecins) ──────────────────────
function buildMaintenanceActivatedEmail(firstName: string): string {
  return emailWrapper(
    emailHeader() +
    bodyRow(
      statusBadge("Maintenance en cours", {
        bg: "#FFF8ED", border: "#FDDBA0",
        dot: "#CA8A04", text: "#78350F"
      }) +
      h1(`Bonjour ${firstName},`) +
      p(`La plateforme Docline est momentanément indisponible pour maintenance.

**Votre espace médecin reste accessible.** Rendez-vous, patients et ordonnances ne sont pas affectés.

Vous serez notifié dès la reprise du service.`) +
      ctaButton("Accéder à mon espace", APP_URL) +
      signOff()
    ) +
    emailFooter()
  );
}

// ── Reprise après maintenance (tous les médecins + inscrits) ─────
function buildMaintenanceResumeEmail(firstName: string, duration?: string): string {
  const durationLine = duration
    ? `\n\nLa maintenance a duré **${duration}**.`
    : "";
  return emailWrapper(
    emailHeader("Service rétabli") +
    bodyRow(
      statusBadge("Plateforme disponible", {
        bg: "#F0FDF4", border: "#BBF7D0",
        dot: "#16A34A", text: "#15803D"
      }) +
      h1(`Bonjour ${firstName},`) +
      p(`La maintenance est terminée. La plateforme Docline est de nouveau entièrement disponible.${durationLine}

Merci pour votre patience.`) +
      ctaButton("Accéder à la plateforme", APP_URL) +
      signOff()
    ) +
    emailFooter()
  );
}

// ════════════════════════════════════════════════════════════════
// TEMPLATES OCCASIONS SPÉCIALES
// ════════════════════════════════════════════════════════════════

// ── Eid Al-Fitr ──────────────────────────────────────────────────
function buildEidAlFitrEmail(firstName: string): string {
  return emailWrapper(
    emailHeader("Eid Al-Fitr") +
    bodyRow(
      h1(`Eid Moubarak, ${firstName}.`) +
      p(`Toute l'équipe Docline vous souhaite un joyeux Eid Al-Fitr.

Que cette fête soit l'occasion de partager de beaux moments avec vos proches.`) +
      signOff()
    ) +
    emailFooter()
  );
}

// ── Eid Al-Adha ──────────────────────────────────────────────────
function buildEidAlAdhaEmail(firstName: string): string {
  return emailWrapper(
    emailHeader("Eid Al-Adha") +
    bodyRow(
      h1(`Eid Moubarak, ${firstName}.`) +
      p(`Docline vous souhaite un Eid Al-Adha béni, partagé en famille dans la joie et la santé.`) +
      signOff()
    ) +
    emailFooter()
  );
}

// ── Ramadan Kareem ───────────────────────────────────────────────
function buildRamadanEmail(firstName: string): string {
  return emailWrapper(
    emailHeader("Ramadan Kareem") +
    bodyRow(
      h1(`Ramadan Kareem, ${firstName}.`) +
      p(`L'équipe Docline vous souhaite un mois de Ramadan plein de sérénité, de santé et de bénédictions.`) +
      signOff()
    ) +
    emailFooter()
  );
}

// ── Newsletter ───────────────────────────────────────────────────
function buildNewsletterEmail(
  subject: string, heading: string, body: string,
  cta?: { text: string; url: string }
): string {
  return emailWrapper(
    emailHeader("Docline News") +
    bodyRow(
      h1(heading) +
      p(body) +
      (cta ? ctaButton(cta.text, cta.url) : "") +
      signOff()
    ) +
    emailFooter()
  );
}

// ── Template facture ─────────────────────────────────────────────
function buildInvoiceEmail(inv: any, from: string): string {
  const total = new Intl.NumberFormat("fr-DZ", { style: "currency", currency: "DZD" })
    .format(inv.total || 0)
    .replace("DZD", "DA");

  const itemsHtml = Array.isArray(inv.items) && inv.items.length
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
        <tr style="background:#F7F4FE">
          <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;
                     color:#7B6DA0;text-transform:uppercase;letter-spacing:.8px;${FONT}">Description</th>
          <th style="text-align:center;padding:10px 14px;font-size:11px;font-weight:700;
                     color:#7B6DA0;text-transform:uppercase;letter-spacing:.8px;${FONT}">Qté</th>
          <th style="text-align:right;padding:10px 14px;font-size:11px;font-weight:700;
                     color:#7B6DA0;text-transform:uppercase;letter-spacing:.8px;${FONT}">Montant</th>
        </tr>
        ${inv.items.map((it: any) => `
        <tr>
          <td style="padding:11px 14px;border-bottom:1px solid #EDE5FA;color:#4A3D6A;
                     font-size:13px;${FONT}">${it.description || "–"}</td>
          <td style="padding:11px 14px;border-bottom:1px solid #EDE5FA;text-align:center;
                     color:#7B6DA0;font-size:13px;${FONT}">${it.quantity || 1}</td>
          <td style="padding:11px 14px;border-bottom:1px solid #EDE5FA;text-align:right;
                     font-weight:700;color:#1A0E2E;font-size:13px;${FONT}">
                     ${new Intl.NumberFormat("fr-DZ", { style: "currency", currency: "DZD" })
                       .format(it.unit_price || 0).replace("DZD", "DA")}</td>
        </tr>`).join("")}
      </table>`
    : "";

  const body = bodyRow(
    `<!-- From / To -->
    <table width="100%" style="margin-bottom:28px"><tr>
      <td style="vertical-align:top">
        <div style="font-size:10px;font-weight:700;color:#9B8CB8;text-transform:uppercase;
                    letter-spacing:1px;margin-bottom:6px;${FONT}">Émis par</div>
        <div style="font-size:14px;font-weight:700;color:#1A0E2E;${FONT}">${from}</div>
      </td>
      <td style="text-align:right;vertical-align:top">
        <div style="font-size:10px;font-weight:700;color:#9B8CB8;text-transform:uppercase;
                    letter-spacing:1px;margin-bottom:6px;${FONT}">Destinataire</div>
        <div style="font-size:14px;font-weight:700;color:#1A0E2E;${FONT}">
          ${inv.client_name || inv.client_email}</div>
      </td>
    </tr></table>

    <!-- Meta -->
    <table width="100%" style="background:#F7F4FE;border-radius:12px;
                                border:1px solid #E8DFF5;margin-bottom:24px">
      <tr>
        <td style="padding:12px 18px;border-bottom:1px solid #E8DFF5">
          <span style="font-size:12px;color:#7B6DA0;${FONT}">Numéro</span>
          <span style="float:right;font-weight:700;color:#1A0E2E;font-size:13px;${FONT}">
            ${inv.invoice_number}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 18px;border-bottom:1px solid #E8DFF5">
          <span style="font-size:12px;color:#7B6DA0;${FONT}">Date d'émission</span>
          <span style="float:right;color:#1A0E2E;font-size:13px;${FONT}">
            ${inv.issue_date || "–"}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 18px">
          <span style="font-size:12px;color:#7B6DA0;${FONT}">Échéance</span>
          <span style="float:right;color:#1A0E2E;font-size:13px;${FONT}">
            ${inv.due_date || "–"}</span>
        </td>
      </tr>
    </table>

    ${itemsHtml}

    <!-- Total -->
    <table width="100%" style="margin-bottom:24px"><tr>
      <td style="background:linear-gradient(135deg,#2D1259,#5B21B6);border-radius:12px;padding:18px 24px">
        <table width="100%"><tr>
          <td style="color:rgba(255,255,255,.7);font-size:13px;font-weight:600;${FONT}">Total TTC</td>
          <td style="text-align:right;color:#fff;font-size:26px;font-weight:900;${FONT}">${total}</td>
        </tr></table>
      </td>
    </tr></table>

    ${inv.notes ? `<div style="padding:14px 18px;background:#FFFBEB;border-left:3px solid #F79009;
                               border-radius:0 10px 10px 0;font-size:13px;color:#6B4E00;
                               margin-bottom:24px;${FONT}">
                    <strong>Note :</strong> ${inv.notes}</div>` : ""}

    <div style="border-top:1px solid #EDE5F7;padding-top:18px">
      <p style="margin:0;font-size:12px;color:#9B8CB8;${FONT}">
        Envoyé par <strong style="color:#4A3570">${from}</strong> via Docline
      </p>
    </div>`
  );

  return emailWrapper(
    `<tr><td style="background:linear-gradient(145deg,#140533 0%,#2E0F60 40%,#5118A8 100%);
                    border-radius:12px 12px 0 0;padding:32px 48px">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle">
          <img src="${LOGO_PNG}" alt="Docline" width="140" height="26" border="0"
               style="display:block;border:0;max-width:140px;height:auto">
        </td>
        <td style="text-align:right;vertical-align:middle">
          <div style="color:rgba(255,255,255,.45);font-size:10px;text-transform:uppercase;
                      letter-spacing:1.5px;font-weight:600;${FONT}">Facture</div>
          <div style="color:#fff;font-size:20px;font-weight:700;margin-top:4px;${FONT}">
            ${inv.invoice_number}</div>
        </td>
      </tr></table>
    </td></tr>
    ${body}
    ${emailFooter()}`
  );
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
    const html = buildBaseEmail(subject, String(custom.html));
    ok = await sendEmail(to, subject, html);
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
      trial_expiring:    "Essai bientôt terminé",
      payment_confirmed: "Paiement confirmé",
      contact_autoreply: undefined,
    };
    html = buildBaseEmail(heading, intro, cta, badges[type]);
  }

  const recipient = payload?.to ?? userEmail;
  ok = await sendEmail(recipient, subject, html);
  await logEmail({ type, to: recipient, name: firstName, subject, status: ok ? "sent" : "failed", triggeredBy: userEmail });

  if (type === "welcome" && ok) {
    await supabase.from("profiles").update({ welcome_email_sent: true }).eq("id", userId);
  }

  return new Response(JSON.stringify({ success: ok }), {
    status: ok ? 200 : 500,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
