// Docline · envoi de SMS (Twilio), un seul point d'entrée pour toutes les fonctions.
//
// Expéditeur : Messaging Service s'il est configuré, sinon l'expéditeur alphanumérique « Docline »
// (accepté par Twilio pour l'Algérie sans enregistrement, entreprise internationale), sinon un numéro.
// Chaque message est journalisé (message_logs) et son statut de remise mis à jour par twilio-status.
// Hors codes de vérification, rien n'est envoyé entre 21 h et 8 h, heure d'Alger.

const SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const MSG_SERVICE = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") ?? "";
const SENDER_ID = Deno.env.get("TWILIO_SENDER_ID") ?? "";          // ex. « Docline », une fois enregistré
const FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";      // dernier recours
const SUPA_URL = Deno.env.get("SUPABASE_URL") ?? "";

export type MessageKind = "otp" | "staff_code" | "booking_confirmation" | "appointment_sms" | "reminder" | "cancellation" | "test";
// Qui déclenche l'envoi : public (patient, page ouverte à tous), staff (activation d'un membre),
// doctor (action d'un cabinet), system (automatique), admin (test depuis Symphony)
export type MessageScope = "public" | "staff" | "doctor" | "system" | "admin";
const DEFAULT_SCOPE: Record<MessageKind, MessageScope> = {
  otp: "public", staff_code: "staff", booking_confirmation: "system", appointment_sms: "doctor",
  reminder: "system", cancellation: "doctor", test: "admin",
};

// ── Protection contre les abus ─────────────────────────────────────────
// Appliquée avant chaque SMS. Un refus est journalisé (statut « blocked ») avec sa raison.
const LIMITS = {
  codeCooldownS: 60,        // codes : un envoi par minute et par numéro
  codesPerHour: 4,          // codes : 4 par heure et par numéro
  otherPerDay: 10,          // autres messages : 10 par jour et par numéro
  ipPerHour: 5,             // pages publiques : 5 SMS par heure et par connexion (adresse IP)
  ipPerDay: 15,
  doctorPerDay: 150,        // un cabinet : 150 SMS par jour au total
};
export const GUARD_MESSAGES: Record<string, string> = {
  PAUSED: "L’envoi de SMS est momentanément suspendu. Réessayez plus tard ou appelez le cabinet.",
  BLOCKED_NUMBER: "Ce numéro ne reçoit plus de SMS Docline. Contactez le cabinet si c’est une erreur.",
  INVALID_NUMBER: "Ce numéro ne semble pas valide. Vérifiez-le.",
  COUNTRY_NOT_ALLOWED: "Seuls les numéros mobiles algériens (05, 06, 07) sont acceptés.",
  TOO_FAST: "Un code vient d’être envoyé. Patientez une minute avant d’en demander un autre.",
  NUMBER_HOURLY: "Trop de codes demandés pour ce numéro. Réessayez dans une heure.",
  NUMBER_DAILY: "Trop de SMS envoyés à ce numéro aujourd’hui. Réessayez demain ou appelez le cabinet.",
  IP_HOURLY: "Trop de demandes depuis cette connexion. Réessayez dans une heure.",
  IP_DAILY: "Trop de demandes depuis cette connexion aujourd’hui. Réessayez demain.",
  DOCTOR_DAILY: "Limite quotidienne de SMS du cabinet atteinte.",
  GLOBAL_HOURLY: "L’envoi de SMS est momentanément limité. Réessayez dans un instant.",
  GLOBAL_DAILY: "L’envoi de SMS est momentanément limité. Réessayez plus tard.",
};
export function guardMessage(code?: string) { return (code && GUARD_MESSAGES[code]) || "Le SMS n’a pas pu être envoyé. Réessayez dans un instant."; }

// Adresse IP de l'appelant (Cloudflare / proxy Supabase), réduite à une empreinte
export async function ipHashFrom(req: Request): Promise<string | null> {
  const ip = req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  return ip ? (await sha256hex("ip:" + ip)).slice(0, 32) : null;
}

// Numéros manifestement fictifs : fin répétée (000000, 111111…) ou suite (123456, 654321)
function looksFake(e164: string): boolean {
  const d = e164.replace(/\D/g, "");
  const tail = d.slice(-6);
  return /^(\d)\1{5}$/.test(tail) || tail === "123456" || tail === "654321" || /(\d)\1{6,}/.test(d);
}

let settingsCache: { at: number; v: { paused: boolean; hourly_cap: number; daily_cap: number; per_number_day: number } } | null = null;
// deno-lint-ignore no-explicit-any
async function guardSettings(admin: any) {
  if (settingsCache && Date.now() - settingsCache.at < 30_000) return settingsCache.v;
  const { data } = await admin.from("sms_guard_settings").select("paused, hourly_cap, daily_cap, per_number_day").eq("id", 1).maybeSingle();
  const v = data ?? { paused: false, hourly_cap: 200, daily_cap: 1200, per_number_day: 8 };
  settingsCache = { at: Date.now(), v };
  return v;
}
// deno-lint-ignore no-explicit-any
async function countLogs(admin: any, col: string, val: string, sinceMs: number): Promise<number> {
  const { count } = await admin.from("message_logs").select("id", { count: "exact", head: true })
    .eq(col, val).gte("created_at", new Date(Date.now() - sinceMs).toISOString()).not("status", "in", "(blocked,skipped)");
  return count ?? 0;
}
// deno-lint-ignore no-explicit-any
async function countAll(admin: any, sinceMs: number): Promise<number> {
  const { count } = await admin.from("message_logs").select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - sinceMs).toISOString()).not("status", "in", "(blocked,skipped)");
  return count ?? 0;
}

// deno-lint-ignore no-explicit-any
async function guard(admin: any, o: { to: string; toHash: string; kind: MessageKind; scope: MessageScope; ipHash: string | null; doctorId: string | null }): Promise<string | null> {
  const st = await guardSettings(admin);
  if (o.kind === "test") return null;                                   // test manuel depuis Symphony (permission Paramètres)
  if (st.paused) return "PAUSED";
  const { data: bl } = await admin.from("sms_blocklist").select("to_hash").eq("to_hash", o.toHash).maybeSingle();
  if (bl) return "BLOCKED_NUMBER";
  if (looksFake(o.to)) return "INVALID_NUMBER";
  if (o.scope === "public" && !o.to.startsWith("+213")) return "COUNTRY_NOT_ALLOWED";

  const isCode = o.kind === "otp" || o.kind === "staff_code";
  if (isCode) {
    const { data: last } = await admin.from("message_logs").select("created_at").eq("to_hash", o.toHash).in("kind", ["otp", "staff_code"])
      .not("status", "in", "(blocked,skipped)").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - new Date(last.created_at).getTime() < LIMITS.codeCooldownS * 1000) return "TOO_FAST";
    if (await countLogs(admin, "to_hash", o.toHash, 3_600_000) >= LIMITS.codesPerHour) return "NUMBER_HOURLY";
  }
  const perDay = isCode ? st.per_number_day : LIMITS.otherPerDay;
  if (await countLogs(admin, "to_hash", o.toHash, 86_400_000) >= perDay) return "NUMBER_DAILY";
  if (o.ipHash && (o.scope === "public" || o.scope === "staff")) {
    if (await countLogs(admin, "ip_hash", o.ipHash, 3_600_000) >= LIMITS.ipPerHour) return "IP_HOURLY";
    if (await countLogs(admin, "ip_hash", o.ipHash, 86_400_000) >= LIMITS.ipPerDay) return "IP_DAILY";
  }
  if (o.doctorId && await countLogs(admin, "doctor_id", o.doctorId, 86_400_000) >= LIMITS.doctorPerDay) return "DOCTOR_DAILY";
  if (await countAll(admin, 3_600_000) >= st.hourly_cap) return "GLOBAL_HOURLY";
  if (await countAll(admin, 86_400_000) >= st.daily_cap) return "GLOBAL_DAILY";
  return null;
}

// Alerte (au plus une par heure) quand un plafond global est atteint : signe d'une attaque probable
// deno-lint-ignore no-explicit-any
async function alertTeam(admin: any, code: string) {
  try {
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await admin.from("email_logs").select("id", { count: "exact", head: true }).eq("type", "sms_guard_alert").gte("created_at", since);
    if ((count ?? 0) > 0) return;
    const { sendEmail, logEmail, layout, para, button } = await import("./email.ts");
    const to = Deno.env.get("ADMIN_EMAIL") || "contact@docline.health";
    const html = layout({ eyebrow: "Alerte SMS", preheader: "Un plafond d’envoi de SMS a été atteint.", title: "Envois de SMS limités",
      body: para(`Le plafond ${code === "GLOBAL_HOURLY" ? "horaire" : "quotidien"} d’envoi de SMS vient d’être atteint. Les nouveaux SMS sont refusés jusqu’à la fin de la période.`)
        + para("Cela peut être un pic normal d’activité, ou une tentative d’abus (envois en masse vers des numéros payants). Vérifiez les derniers messages et, si besoin, suspendez les envois.")
        + button("Ouvrir le suivi des SMS", "https://docline.health/symphony-messaging"),
      reason: "Alerte automatique de la protection des SMS Docline." });
    const ok = await sendEmail(to, "Alerte : plafond de SMS atteint", html);
    await logEmail({ type: "sms_guard_alert", to, subject: "Alerte : plafond de SMS atteint", status: ok ? "sent" : "failed", metadata: { code } });
  } catch (_) { /* une alerte ne doit jamais bloquer */ }
}


export function messagingConfig() {
  return {
    account: !!(SID && TOKEN),
    messaging_service: !!MSG_SERVICE,
    sender_id: SENDER_ID || null,
    from_number: !!FROM_NUMBER,
  };
}

export function normalizePhone(raw: string): string | null {
  const p = String(raw || "").replace(/[\s\-\.\(\)]/g, "");
  if (/^0[5-7]\d{8}$/.test(p)) return "+213" + p.slice(1);          // mobile algérien 05, 06, 07
  if (/^\+213[5-7]\d{8}$/.test(p)) return p;
  if (/^00213[5-7]\d{8}$/.test(p)) return "+" + p.slice(2);
  if (/^\+\d{8,15}$/.test(p) && !p.startsWith("+213")) return p;     // numéro étranger
  return null;
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function quietHours(): boolean {
  const h = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hour12: false, timeZone: "Africa/Algiers" }).format(new Date()));
  return h >= 21 || h < 8;
}

// Alphabet SMS standard (GSM 7 bits) : un seul accent ferait passer le SMS en Unicode,
// limité à 70 caractères au lieu de 160, donc facturé double. On retire accents et guillemets typographiques.
export function smsSafe(text: string): string {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ]/g, "'").replace(/[«»“”]/g, '"')
    .replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[  ]/g, " ")
    .replace(/[^\x20-\x7E\n]/g, "");
}

async function twilioPost(params: Record<string, string>) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

// deno-lint-ignore no-explicit-any
export async function sendMessage(admin: any, o: { to: string; kind: MessageKind; text: string; doctorId?: string | null; scope?: MessageScope; ipHash?: string | null }):
  Promise<{ sent: boolean; channel?: string; error?: string }> {
  const to = normalizePhone(o.to);
  if (!to) return { sent: false, error: "INVALID_PHONE" };
  if (!SID || !TOKEN) return { sent: false, error: "NOT_CONFIGURED" };

  const toHash = await sha256hex(to);
  const scope = o.scope ?? DEFAULT_SCOPE[o.kind];
  const base = { kind: o.kind, to_hash: toHash, to_hint: to.slice(0, 4) + " ••• " + to.slice(-3), doctor_id: o.doctorId ?? null, scope, ip_hash: o.ipHash ?? null };

  const refused = await guard(admin, { to, toHash, kind: o.kind, scope, ipHash: o.ipHash ?? null, doctorId: o.doctorId ?? null });
  if (refused) {
    await admin.from("message_logs").insert({ ...base, channel: "sms", status: "blocked", error_code: refused, error_message: GUARD_MESSAGES[refused] ?? refused });
    if (refused === "GLOBAL_HOURLY" || refused === "GLOBAL_DAILY") await alertTeam(admin, refused);
    return { sent: false, error: refused };
  }
  const callback = SUPA_URL ? `${SUPA_URL}/functions/v1/twilio-status` : "";

  if (o.kind !== "otp" && o.kind !== "staff_code" && o.kind !== "test" && quietHours()) {
    await admin.from("message_logs").insert({ ...base, channel: "sms", status: "skipped", error_message: "Heures de silence (21 h - 8 h)" });
    return { sent: false, error: "QUIET_HOURS" };
  }

  const attempts: Array<{ channel: string; params: Record<string, string> }> = [];
  const sms: Record<string, string> = { To: to, Body: smsSafe(o.text) };
  if (MSG_SERVICE) sms.MessagingServiceSid = MSG_SERVICE;
  else if (SENDER_ID) sms.From = SENDER_ID;
  else if (FROM_NUMBER) sms.From = FROM_NUMBER;
  if (sms.MessagingServiceSid || sms.From) attempts.push({ channel: "sms", params: sms });
  if (!attempts.length) return { sent: false, error: "NO_SENDER" };

  let lastError = "SEND_FAILED";
  for (const a of attempts) {
    if (callback) a.params.StatusCallback = callback;
    const { data: row } = await admin.from("message_logs").insert({ ...base, channel: a.channel, status: "queued" }).select("id").single();
    const r = await twilioPost(a.params);
    if (r.ok && r.json?.sid) {
      await admin.from("message_logs").update({ status: r.json.status || "sent", provider_sid: r.json.sid, updated_at: new Date().toISOString() }).eq("id", row?.id);
      return { sent: true, channel: a.channel };
    }
    lastError = String(r.json?.code ?? "SEND_FAILED");
    await admin.from("message_logs").update({ status: "failed", error_code: lastError, error_message: String(r.json?.message ?? "").slice(0, 300),
      updated_at: new Date().toISOString() }).eq("id", row?.id);
  }
  return { sent: false, error: lastError };
}

// Tests unitaires uniquement
export const __guardForTests = guard;
export function __resetGuardCache() { settingsCache = null; }
