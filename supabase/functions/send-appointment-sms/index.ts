import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Config ─────────────────────────────────────────────────────────────
// Twilio SMS
const TW_SID   = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")   ?? "";
const TW_FROM  = Deno.env.get("TWILIO_FROM_NUMBER")  ?? "";

// ── Helpers ────────────────────────────────────────────────────────────

function formatDateFr(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  const J = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const M = ["jan", "fev", "mar", "avr", "mai", "juin", "juil", "aout", "sep", "oct", "nov", "dec"];
  return `${J[d.getDay()]} ${d.getDate()} ${M[d.getMonth()]}`;
}

// ── Rappel SMS (Twilio) ───────────────────────────────────────────────
async function sendRappelSMS(to: string, p: {
  patientName: string; doctorName: string; date: string; time: string;
}): Promise<boolean> {
  if (!TW_SID || !TW_TOKEN || !TW_FROM) {
    console.warn("[DEV] Twilio non configuré — rappel SMS ignoré");
    return false;
  }
  const text =
    `Docline - Rappel RDV\n` +
    `Bonjour ${p.patientName},\n` +
    `Votre RDV avec ${p.doctorName} est le ${formatDateFr(p.date)} a ${p.time}.\n` +
    `Pour annuler, appelez votre medecin.`;
  console.log(`[SMS] Rappel Twilio vers ${to}`);
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
    const body = await res.text();
    console.log(`[SMS] Twilio response ${res.status}: ${body}`);
    return res.ok;
  } catch (e) {
    console.error("[SMS] Exception Twilio:", e);
    return false;
  }
}

// ── Main ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }),
      { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  try {
    // Vérifier que c'est bien le médecin propriétaire
    const supaDoc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );
    const { data: { user } } = await supaDoc.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "UNAUTHORIZED" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const { appointmentId } = await req.json();
    if (!appointmentId) {
      return new Response(JSON.stringify({ error: "MISSING_APPOINTMENT_ID" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Charger le RDV
    const { data: appt, error: apptErr } = await supa.from("appointments")
      .select("id, doctor_id, patient_name, patient_phone, requested_date, requested_time, status, patient_confirmed")
      .eq("id", appointmentId).eq("doctor_id", user.id).single();

    if (apptErr || !appt) {
      return new Response(JSON.stringify({ error: "NOT_FOUND" }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    if (!appt.patient_phone) {
      return new Response(JSON.stringify({ error: "NO_PHONE", message: "Ce patient n'a pas de numéro de téléphone." }),
        { status: 422, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    if (appt.patient_confirmed) {
      return new Response(JSON.stringify({ error: "ALREADY_CONFIRMED", message: "Ce patient a déjà confirmé sa présence." }),
        { status: 409, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Charger le médecin
    const { data: doc } = await supa.from("profiles")
      .select("full_name, first_name, last_name, clinic_name, is_clinic").eq("id", user.id).single();
    const doctorName = doc?.full_name
      || (doc?.is_clinic ? doc?.clinic_name : `Dr. ${doc?.last_name ?? ""}`.trim())
      || "votre médecin";

    const opts = {
      patientName: appt.patient_name,
      doctorName,
      date: appt.requested_date,
      time: appt.requested_time,
    };

    const sent = await sendRappelSMS(appt.patient_phone, opts);

    // Marquer comme envoyé
    await supa.from("appointments").update({ sms_confirmation_sent: true }).eq("id", appointmentId);

    return new Response(
      JSON.stringify({ ok: true, message: sent ? "Rappel SMS envoyé." : "Rappel en attente (Twilio non configuré)." }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("send-appointment-sms error:", e);
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR", message: String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
