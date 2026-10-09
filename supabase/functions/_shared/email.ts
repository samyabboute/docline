// Docline — modèle d'email commun (charte graphique v1.0).
// Fond lumière, carte blanche, logo officiel en PNG (les SVG ne s'affichent pas dans Gmail),
// bouton pilule violet, titres en minuscules, aucun émoji, aucune affirmation non vérifiée.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const APP_URL = Deno.env.get("APP_URL") ?? "https://docline.health";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const LOGO = `${APP_URL}/email-logo.png`;

const C = {
  bg: "#FBFAFD", card: "#FFFFFF", fill: "#F4F2F8", line: "#ECE8F4",
  ink: "#0D0520", ink2: "#3B3551", ink3: "#6E6880", accent: "#4C1D95", soft: "#F1EEFA",
  orange: "#EA580C", ok: "#1E7F4E", okSoft: "#EDF7F1", warn: "#B45309", warnSoft: "#FEF6E7",
  bad: "#B42318", badSoft: "#FDF0EF",
};
const FONT = "font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Paragraphe : \n\n sépare les paragraphes, **gras** autorisé. Le texte est échappé. */
export function para(text: string): string {
  return text.trim().split(/\n\n/).map((t) =>
    `<p style="margin:0 0 14px;${FONT};font-size:15px;line-height:1.6;color:${C.ink2}">` +
    esc(t.trim()).replace(/ ([:;?!»])/g, "&nbsp;$1").replace(/\n/g, "<br>").replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.ink};font-weight:600">$1</strong>`) +
    `</p>`).join("");
}

export function button(text: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 22px"><tr>
    <td style="border-radius:999px;background:${C.accent}">
      <a href="${esc(url)}" style="display:inline-block;padding:14px 28px;border-radius:999px;background:${C.accent};color:#FFFFFF;${FONT};font-size:15px;font-weight:600;text-decoration:none">${esc(text)}</a>
    </td></tr></table>`;
}

export function link(text: string, url: string): string {
  return `<p style="margin:14px 0 0;${FONT};font-size:14px"><a href="${esc(url)}" style="color:${C.accent};font-weight:600;text-decoration:none">${esc(text)}</a></p>`;
}

type Tone = "ok" | "wait" | "bad" | "info";
export function pill(label: string, tone: Tone = "info"): string {
  const t = { ok: [C.okSoft, C.ok], wait: [C.warnSoft, C.warn], bad: [C.badSoft, C.bad], info: [C.soft, C.accent] }[tone];
  return `<span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${t[0]};color:${t[1]};${FONT};font-size:12px;font-weight:600">${esc(label)}</span>`;
}

/** Bloc récapitulatif : lignes libellé / valeur sur fond aplat. */
export function details(rows: Array<[string, string | null | undefined]>): string {
  const r = rows.filter(([, v]) => v);
  if (!r.length) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 22px;background:${C.fill};border-radius:16px">
    ${r.map(([k, v], i) => `<tr>
      <td style="padding:12px 18px;${i ? `border-top:1px solid ${C.line};` : ""}${FONT};font-size:14px;color:${C.ink3};white-space:nowrap">${esc(k)}</td>
      <td style="padding:12px 18px;${i ? `border-top:1px solid ${C.line};` : ""}${FONT};font-size:14px;color:${C.ink};font-weight:600;text-align:right">${esc(v)}</td>
    </tr>`).join("")}
  </table>`;
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MONTHS_FULL = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

export function frDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const day = DAYS[d.getDay()];
  return `${day.charAt(0).toUpperCase() + day.slice(1)} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

/** Signature visuelle Docline : mini-calendrier (mois en orange, jour en encre) + texte à droite. */
export function apptCard(isoDate: string, time: string, title: string, sub: string): string {
  const d = new Date(isoDate + "T12:00:00");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 22px;border:1px solid ${C.line};border-radius:18px">
    <tr>
      <td width="72" style="padding:16px 0 16px 16px;vertical-align:middle">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="64" style="background:${C.fill};border-radius:14px">
          <tr><td align="center" style="padding:8px 0 0;${FONT};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.orange}">${MONTHS[d.getMonth()]}</td></tr>
          <tr><td align="center" style="${FONT};font-size:26px;font-weight:800;line-height:1.1;color:${C.ink}">${d.getDate()}</td></tr>
          <tr><td align="center" style="padding:0 0 8px;${FONT};font-size:12px;font-weight:600;color:${C.ink3}">${esc(time)}</td></tr>
        </table>
      </td>
      <td style="padding:16px 18px;vertical-align:middle">
        <div style="${FONT};font-size:16px;font-weight:700;color:${C.ink};letter-spacing:-.01em">${esc(title)}</div>
        <div style="${FONT};font-size:14px;color:${C.ink3};margin-top:3px;line-height:1.45">${esc(sub)}</div>
      </td>
    </tr>
  </table>`;
}

/** Mise en page complète. `body` est du HTML déjà construit avec les helpers ci-dessus. */
export function layout(o: { preheader: string; title: string; body: string; reason?: string }): string {
  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(o.title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${esc(o.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}">
  <tr><td align="center" style="padding:36px 16px 40px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
      <tr><td style="padding:0 6px 26px">
        <a href="${APP_URL}" style="text-decoration:none"><img src="${LOGO}" width="132" height="33" alt="Docline" style="display:block;border:0;width:132px;height:auto"></a>
      </td></tr>
      <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:24px;padding:40px 36px 34px">
        <h1 style="margin:0 0 16px;${FONT};font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-.03em;color:${C.ink}">${esc(o.title)}</h1>
        ${o.body}
      </td></tr>
      <tr><td style="padding:24px 6px 0;${FONT};font-size:12px;line-height:1.7;color:${C.ink3}">
        ${o.reason ? esc(o.reason) + "<br>" : ""}
        <a href="${APP_URL}" style="color:${C.accent};font-weight:600;text-decoration:none">docline.health</a>
        &nbsp;·&nbsp;<a href="${APP_URL}/privacy" style="color:${C.ink3};text-decoration:none">Confidentialité</a>
        &nbsp;·&nbsp;<a href="mailto:contact@docline.health" style="color:${C.ink3};text-decoration:none">contact@docline.health</a>
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
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, txt) => `${txt.replace(/<[^>]+>/g, "").trim()} (${href})`)
    .replace(/<\/(p|h1|tr|div)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&middot;|·/g, "·")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

export async function sendEmail(to: string, subject: string, html: string, replyTo?: string): Promise<boolean> {
  if (!RESEND_KEY) { console.warn("[email] RESEND_API_KEY manquante"); return false; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Docline <noreply@docline.health>", to: [to], subject, html, text: toText(html),
      ...(replyTo ? { reply_to: replyTo } : {}),
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
