// Docline : modèle d'email commun.
// Esprit Apple aux couleurs Docline : fond lavande très clair, une carte blanche aérée,
// logo centré, titre à l'encre, bouton violet, aucun émoji, aucune affirmation non vérifiée.
// Le logo est un PNG (les SVG ne s'affichent pas dans Gmail).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Adresse publique du site. Elle ne dépend pas d'un réglage serveur : un mauvais réglage
// envoyait autrefois logo et liens vers un ancien site.
export const SITE = "https://docline.health";
export const APP_URL = SITE;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const LOGO = `${SITE}/email-logo.png`;

const C = {
  bg: "#F7F6FF", card: "#FFFFFF", fill: "#F7F5FF", line: "#EEEAF7",
  ink: "#0D0520", ink2: "#3B3551", ink3: "#77718C", accent: "#4C1D95", accent2: "#6D28D9", soft: "#EDE9FE",
  ok: "#127A47", okSoft: "#EAF7F0", warn: "#A15C07", warnSoft: "#FEF5E6", bad: "#B42318", badSoft: "#FDF0EF",
};
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";
const FONT_D = "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Paragraphe centré : \n\n sépare les paragraphes, **gras** autorisé. Le texte est échappé. */
export function para(text: string): string {
  return text.trim().split(/\n\n/).map((t) =>
    `<p style="margin:0 0 14px;${FONT};font-size:16px;line-height:1.6;color:${C.ink2};text-align:center">` +
    esc(t.trim()).replace(/ ([:;?!»])/g, "&nbsp;$1").replace(/\n/g, "<br>").replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.ink};font-weight:600">$1</strong>`) +
    `</p>`).join("");
}

/** Bouton principal, centré. */
export function button(text: string, url: string): string {
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:30px auto 8px"><tr>
    <td align="center" style="border-radius:999px;background:${C.accent}">
      <a href="${esc(url)}" style="display:inline-block;padding:15px 32px;border-radius:999px;background:${C.accent};color:#FFFFFF;${FONT};font-size:16px;font-weight:600;letter-spacing:-.01em;text-decoration:none">${esc(text)}</a>
    </td></tr></table>`;
}

/** Lien secondaire, centré. */
export function link(text: string, url: string): string {
  return `<p style="margin:16px 0 0;${FONT};font-size:15px;text-align:center"><a href="${esc(url)}" style="color:${C.accent2};font-weight:600;text-decoration:none">${esc(text)} &rsaquo;</a></p>`;
}

type Tone = "ok" | "wait" | "bad" | "info";
export function pill(label: string, tone: Tone = "info"): string {
  const t = { ok: [C.okSoft, C.ok], wait: [C.warnSoft, C.warn], bad: [C.badSoft, C.bad], info: [C.soft, C.accent] }[tone];
  return `<p style="margin:0 0 18px;text-align:center"><span style="display:inline-block;padding:6px 14px;border-radius:999px;background:${t[0]};color:${t[1]};${FONT};font-size:13px;font-weight:600">${esc(label)}</span></p>`;
}

/** Récapitulatif : libellé à gauche, valeur à droite, sur fond lavande. */
export function details(rows: Array<[string, string | null | undefined]>): string {
  const r = rows.filter(([, v]) => v);
  if (!r.length) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 24px;background:${C.fill};border-radius:18px">
    ${r.map(([k, v], i) => `<tr>
      <td style="padding:14px 20px;${i ? `border-top:1px solid ${C.line};` : ""}${FONT};font-size:14px;color:${C.ink3};white-space:nowrap;vertical-align:top">${esc(k)}</td>
      <td style="padding:14px 20px;${i ? `border-top:1px solid ${C.line};` : ""}${FONT};font-size:14px;color:${C.ink};font-weight:600;text-align:right">${esc(v)}</td>
    </tr>`).join("")}
  </table>`;
}

/** Montant mis en avant (reçu, relevé). */
export function amount(value: string, caption: string): string {
  return `<p style="margin:6px 0 2px;${FONT_D};font-size:44px;line-height:1.1;font-weight:700;letter-spacing:-.04em;color:${C.ink};text-align:center">${esc(value)}</p>
    <p style="margin:0 0 6px;${FONT};font-size:14px;color:${C.ink3};text-align:center">${esc(caption)}</p>`;
}

const MONTHS_FULL = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

export function frDate(iso: string): string {
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00");
  const day = DAYS[d.getDay()];
  return `${day} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

/** Carte de rendez-vous : la date en grand, l'heure en violet, puis le médecin et le lieu. */
export function apptCard(isoDate: string, time: string, title: string, sub: string): string {
  const d = new Date(String(isoDate).slice(0, 10) + "T12:00:00");
  const day = DAYS[d.getDay()];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 24px;background:${C.fill};border-radius:20px">
    <tr><td align="center" style="padding:26px 22px 24px">
      <div style="${FONT};font-size:13px;font-weight:600;color:${C.ink3};text-transform:capitalize">${esc(day)}</div>
      <div style="${FONT_D};font-size:30px;font-weight:700;letter-spacing:-.035em;color:${C.ink};margin-top:2px">${d.getDate()} ${MONTHS_FULL[d.getMonth()]}</div>
      <div style="${FONT_D};font-size:22px;font-weight:600;letter-spacing:-.02em;color:${C.accent2};margin-top:2px">${esc(time)}</div>
      <div style="height:1px;background:${C.line};margin:18px auto 16px;width:64px;line-height:1px;font-size:1px">&nbsp;</div>
      <div style="${FONT};font-size:16px;font-weight:600;color:${C.ink}">${esc(title)}</div>
      ${sub ? `<div style="${FONT};font-size:14px;color:${C.ink3};margin-top:4px;line-height:1.45">${esc(sub)}</div>` : ""}
    </td></tr>
  </table>`;
}

/** Mise en page complète. `body` est du HTML construit avec les helpers ci-dessus. */
export function layout(o: { preheader: string; title: string; body: string; reason?: string; eyebrow?: string }): string {
  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(o.title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${esc(o.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}">
  <tr><td align="center" style="padding:44px 16px 48px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
      <tr><td align="center" style="padding:0 0 30px">
        <a href="${SITE}" style="text-decoration:none"><img src="${LOGO}" width="120" height="30" alt="Docline" style="display:block;border:0;width:120px;height:auto;${FONT};font-size:20px;font-weight:700;color:${C.accent}"></a>
      </td></tr>
      <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:28px;padding:48px 40px 42px">
        ${o.eyebrow ? `<p style="margin:0 0 10px;${FONT};font-size:14px;font-weight:600;color:${C.accent2};text-align:center">${esc(o.eyebrow)}</p>` : ""}
        <h1 style="margin:0 0 18px;${FONT_D};font-size:30px;line-height:1.15;font-weight:700;letter-spacing:-.035em;color:${C.ink};text-align:center">${esc(o.title)}</h1>
        ${o.body}
      </td></tr>
      <tr><td align="center" style="padding:28px 24px 0;${FONT};font-size:12px;line-height:1.7;color:${C.ink3};text-align:center">
        ${o.reason ? esc(o.reason) + "<br>" : ""}
        <a href="${SITE}" style="color:${C.ink3};text-decoration:none;font-weight:600">Docline</a>, le logiciel des cabinets médicaux.<br>
        <a href="${SITE}/privacy" style="color:${C.ink3};text-decoration:underline">Confidentialité</a>
        &nbsp;&nbsp;<a href="mailto:contact@docline.health" style="color:${C.ink3};text-decoration:underline">contact@docline.health</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** Version texte brut (meilleure délivrabilité). */
export function toText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<div style="display:none[\s\S]*?<\/div>/i, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, txt) => {
      const t = txt.replace(/<[^>]+>/g, "").replace(/&rsaquo;/g, "").trim();
      return t ? `${t} (${href})` : "";
    })
    .replace(/<\/(p|h1|tr|div)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&rsaquo;/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#\d+;/g, "")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

export async function sendEmail(to: string, subject: string, html: string, replyTo?: string): Promise<boolean> {
  if (!RESEND_KEY) { console.warn("[email] RESEND_API_KEY manquante"); return false; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Docline <noreply@docline.health>", to: [to], subject, html, text: toText(html),
      reply_to: replyTo || "contact@docline.health",
    }),
  });
  if (!res.ok) console.error("[email] Resend", res.status, await res.text());
  return res.ok;
}

export async function logEmail(p: {
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
  } catch (_) { /* le journal ne doit jamais bloquer un envoi */ }
}
