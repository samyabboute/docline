import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMessage } from "../_shared/messaging.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Config ─────────────────────────────────────────────────────────────

// ── Helpers ────────────────────────────────────────────────────────────

function formatDateFr(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  const J = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const M = ["jan", "fev", "mar", "avr", "mai", "juin", "juil", "aout", "sep", "oct", "nov", "dec"];
  return `${J[d.getDay()]} ${d.getDate()} ${M[d.getMonth()]}`;
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

    // Garde-fou de coût : 100 SMS par cabinet et par jour au plus
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count: today } = await supa.from("message_logs").select("id", { count: "exact", head: true })
      .eq("doctor_id", user.id).gte("created_at", since);
    if ((today ?? 0) >= 100) {
      return new Response(JSON.stringify({ error: "DAILY_LIMIT", message: "Limite de 100 SMS par jour atteinte pour ce cabinet." }),
        { status: 429, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const text = `Docline : rappel de votre RDV avec ${doctorName}, ${formatDateFr(appt.requested_date)} a ${String(appt.requested_time).slice(0, 5)}. En cas d'empechement, prevenez le cabinet.`;
    const r = await sendMessage(supa, { to: appt.patient_phone, kind: "appointment_sms", text, doctorId: user.id });
    if (!r.sent) {
      const msg = r.error === "QUIET_HOURS" ? "Les SMS ne partent pas entre 21 h et 8 h. Réessayez demain matin."
        : r.error === "INVALID_PHONE" ? "Le numéro du patient n'est pas un mobile valide."
        : "Le SMS n'a pas pu être envoyé. Réessayez plus tard.";
      return new Response(JSON.stringify({ error: r.error ?? "SEND_FAILED", message: msg }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    await supa.from("appointments").update({ sms_confirmation_sent: true }).eq("id", appointmentId);
    return new Response(JSON.stringify({ ok: true, message: "Rappel SMS envoyé." }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("send-appointment-sms error:", e);
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR", message: String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
