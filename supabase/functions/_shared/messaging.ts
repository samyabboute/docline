// Docline · envoi de SMS et WhatsApp (Twilio), un seul point d'entrée pour toutes les fonctions.
//
// Ordre des canaux :
//  * code de vérification (otp) : WhatsApp (modèle d'authentification approuvé par Meta) puis SMS ;
//  * autres messages : SMS.
// SMS vers l'Algérie : l'expéditeur alphanumérique « Docline » doit être enregistré auprès des
// opérateurs (Mobilis, Djezzy, Ooredoo) via Twilio. On passe de préférence par un Messaging Service
// qui porte cet expéditeur ; un numéro classique reste en dernier recours.
// Chaque message est journalisé (message_logs) et son statut de remise mis à jour par twilio-status.
// Hors codes de vérification, rien n'est envoyé entre 21 h et 8 h, heure d'Alger.

const SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const MSG_SERVICE = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") ?? "";
const SENDER_ID = Deno.env.get("TWILIO_SENDER_ID") ?? "";          // ex. « Docline », une fois enregistré
const FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";      // dernier recours
const WA_FROM = Deno.env.get("TWILIO_WA_FROM") ?? "";
const WA_OTP_CONTENT = Deno.env.get("TWILIO_WA_OTP_CONTENT_SID") ?? "";
const SUPA_URL = Deno.env.get("SUPABASE_URL") ?? "";

export type MessageKind = "otp" | "booking_confirmation" | "appointment_sms" | "reminder" | "cancellation" | "test";

export function messagingConfig() {
  return {
    account: !!(SID && TOKEN),
    messaging_service: !!MSG_SERVICE,
    sender_id: SENDER_ID || null,
    from_number: !!FROM_NUMBER,
    whatsapp_sender: !!WA_FROM,
    whatsapp_otp_template: !!WA_OTP_CONTENT,
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
export async function sendMessage(admin: any, o: { to: string; kind: MessageKind; text: string; otp?: string; doctorId?: string | null }):
  Promise<{ sent: boolean; channel?: string; error?: string }> {
  const to = normalizePhone(o.to);
  if (!to) return { sent: false, error: "INVALID_PHONE" };
  if (!SID || !TOKEN) return { sent: false, error: "NOT_CONFIGURED" };

  const toHash = await sha256hex(to);
  const base = { kind: o.kind, to_hash: toHash, to_hint: to.slice(0, 4) + " ••• " + to.slice(-3), doctor_id: o.doctorId ?? null };
  const callback = SUPA_URL ? `${SUPA_URL}/functions/v1/twilio-status` : "";

  if (o.kind !== "otp" && o.kind !== "test" && quietHours()) {
    await admin.from("message_logs").insert({ ...base, channel: "sms", status: "skipped", error_message: "Heures de silence (21 h - 8 h)" });
    return { sent: false, error: "QUIET_HOURS" };
  }

  const attempts: Array<{ channel: string; params: Record<string, string> }> = [];
  if (o.kind === "otp" && o.otp && WA_FROM && WA_OTP_CONTENT) {
    attempts.push({ channel: "whatsapp", params: {
      From: "whatsapp:" + WA_FROM.replace(/^whatsapp:/, ""), To: "whatsapp:" + to,
      ContentSid: WA_OTP_CONTENT, ContentVariables: JSON.stringify({ "1": o.otp }) } });
  }
  const sms: Record<string, string> = { To: to, Body: o.text };
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
