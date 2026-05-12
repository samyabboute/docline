import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Config ─────────────────────────────────────────────────────────────
const OTP_SECRET  = Deno.env.get("OTP_SECRET")         ?? "docline-otp-secret-change-me";
const APP_URL     = Deno.env.get("APP_URL")             ?? "https://samyabboute.github.io/docline";
// Twilio SMS
const TW_SID      = Deno.env.get("TWILIO_ACCOUNT_SID")  ?? "";
const TW_TOKEN    = Deno.env.get("TWILIO_AUTH_TOKEN")    ?? "";
const TW_FROM     = Deno.env.get("TWILIO_FROM_NUMBER")   ?? "";

// ── Helpers ────────────────────────────────────────────────────────────

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function normalizePhone(raw: string): string | null {
  const p = raw.replace(/[\s\-\.]/g, "");
  if (/^0[5-9]\d{8}$/.test(p))  return "+213" + p.slice(1);
  if (/^\+\d{7,15}$/.test(p))   return p;
  if (/^00\d{7,15}$/.test(p))   return "+" + p.slice(2);
  return null;
}

function generateToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/[+/=]/g, c =>
    c === "+" ? "-" : c === "/" ? "_" : ""
  );
}

function formatDateFr(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  const J = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const M = ["jan", "fev", "mar", "avr", "mai", "juin", "juil", "aout", "sep", "oct", "nov", "dec"];
  return `${J[d.getDay()]} ${d.getDate()} ${M[d.getMonth()]}`;
}

// ── Confirmation SMS (Twilio) ──────────────────────────────────────────
async function sendConfirmSMS(to: string, p: {
  patientName: string; doctorName: string; date: string; time: string;
}): Promise<void> {
  if (!TW_SID || !TW_TOKEN || !TW_FROM) {
    console.warn("[DEV] Twilio non configuré — SMS confirmation ignoré");
    return;
  }
  const text =
    `Docline - RDV confirme\n` +
    `Bonjour ${p.patientName},\n` +
    `RDV avec ${p.doctorName}\n` +
    `${formatDateFr(p.date)} a ${p.time}.\n` +
    `Un rappel vous sera envoye 1h avant.`;
  console.log(`[SMS] Confirmation Twilio vers ${to}`);
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: TW_FROM, To: to, Body: text }).toString(),
      }
    );
    console.log(`[SMS] Twilio response ${res.status}: ${await res.text()}`);
  } catch (e) {
    console.error("[SMS] Exception Twilio:", e);
  }
}

// ── Main ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { phone, otp, patientName, doctorId, date, time } = await req.json();

    if (!phone || !otp || !patientName || !doctorId || !date || !time) {
      return new Response(JSON.stringify({ error: "MISSING_FIELDS" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const phoneE164 = normalizePhone(phone);
    if (!phoneE164) {
      return new Response(JSON.stringify({ error: "INVALID_PHONE" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const phoneHash = await sha256hex(phoneE164);
    const supabase  = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Charger l'OTP
    const { data: otpRecord } = await supabase
      .from("otp_verifications").select("*")
      .eq("phone_hash", phoneHash)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }).limit(1).single();

    if (!otpRecord) {
      return new Response(JSON.stringify({ error: "OTP_EXPIRED", message: "Code expiré. Demandez un nouveau code." }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (otpRecord.attempts >= 5) {
      await supabase.from("otp_verifications").delete().eq("id", otpRecord.id);
      return new Response(JSON.stringify({ error: "OTP_MAX_ATTEMPTS", message: "Trop de tentatives. Demandez un nouveau code." }),
        { status: 429, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const expectedHash = await sha256hex(otp + OTP_SECRET + phoneHash);
    if (expectedHash !== otpRecord.otp_hash) {
      await supabase.from("otp_verifications").update({ attempts: otpRecord.attempts + 1 }).eq("id", otpRecord.id);
      const remaining = 5 - otpRecord.attempts - 1;
      return new Response(JSON.stringify({ error: "OTP_INVALID", message: `Code incorrect. ${remaining} tentative(s) restante(s).`, remaining }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // OTP valide
    await supabase.from("otp_verifications").delete().eq("id", otpRecord.id);

    // Vérifier race condition sur le créneau
    const { count: slotCount } = await supabase.from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("doctor_id", doctorId).eq("requested_date", date).eq("requested_time", time)
      .in("status", ["pending", "confirmed"]);

    if ((slotCount ?? 0) > 0) {
      return new Response(JSON.stringify({ error: "SLOT_TAKEN", message: "Ce créneau vient d'être pris. Choisissez un autre horaire." }),
        { status: 409, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Créer ou retrouver le patient
    let patientId: string;
    const { data: existing } = await supabase.from("patients").select("id").eq("phone_hash", phoneHash).single();
    if (existing) {
      patientId = existing.id;
      await supabase.from("patients").update({ full_name: patientName }).eq("id", patientId);
    } else {
      const { data: np, error: pe } = await supabase.from("patients")
        .insert({ phone_hash: phoneHash, phone_e164: phoneE164, full_name: patientName })
        .select("id").single();
      if (pe || !np) throw new Error("Patient creation failed: " + pe?.message);
      patientId = np.id;
    }

    const ticketToken   = generateToken();
    const cancelToken   = generateToken();
    const scheduledAtTs = new Date(`${date}T${time}:00+01:00`).toISOString();

    const { data: appt, error: apptErr } = await supabase.from("appointments")
      .insert({
        doctor_id:       doctorId,
        patient_id:      patientId,
        patient_name:    patientName,
        patient_phone:   phoneE164,
        requested_date:  date,
        requested_time:  time,
        scheduled_at_ts: scheduledAtTs,
        status:          "confirmed",
        ticket_token:    ticketToken,
        cancel_token:    cancelToken,
        reminder_sent:   false,
      })
      .select("id").single();

    if (apptErr || !appt) throw new Error("Appointment creation failed: " + apptErr?.message);

    // Nom du médecin
    const { data: doc } = await supabase.from("profiles")
      .select("first_name, last_name, clinic_name, is_clinic").eq("id", doctorId).single();
    const doctorName = doc?.is_clinic
      ? (doc.clinic_name ?? "votre médecin")
      : `Dr. ${doc?.first_name ?? ""} ${doc?.last_name ?? ""}`.trim() || "votre médecin";

    // Envoyer SMS de confirmation
    await sendConfirmSMS(phoneE164, { patientName, doctorName, date, time });

    const ticketUrl = `${APP_URL}/ticket.html?t=${ticketToken}`;
    return new Response(
      JSON.stringify({ success: true, ticketToken, ticketUrl, appointmentId: appt.id, message: "RDV confirmé ! Confirmation envoyée par SMS." }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("verify-otp-book error:", e);
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR", message: String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
