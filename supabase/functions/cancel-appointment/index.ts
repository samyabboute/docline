import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INFOBIP_KEY  = Deno.env.get("INFOBIP_API_KEY") ?? "";
const INFOBIP_BASE = Deno.env.get("INFOBIP_BASE_URL") ?? "https://api.infobip.com";
const APP_URL      = Deno.env.get("APP_URL") ?? "https://samyabboute.github.io/docline";

async function sendSMS(to: string, text: string): Promise<void> {
  if (!INFOBIP_KEY) {
    console.log(`[DEV] Cancel SMS to ${to}: ${text}`);
    return;
  }
  await fetch(`${INFOBIP_BASE}/sms/2/text/advanced`, {
    method: "POST",
    headers: {
      "Authorization": `App ${INFOBIP_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ destinations: [{ to }], text }],
    }),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Auth : JWT du médecin connecté
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) {
    return new Response(
      JSON.stringify({ error: "UNAUTHORIZED" }),
      { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  try {
    // Client avec JWT médecin (pour vérifier qu'il possède le RDV via RLS)
    const supabaseDoctor = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );
    const { data: { user } } = await supabaseDoctor.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "UNAUTHORIZED" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { appointmentId, reason } = await req.json();
    if (!appointmentId) {
      return new Response(
        JSON.stringify({ error: "MISSING_APPOINTMENT_ID" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Service role pour les opérations de mise à jour
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Vérifier que le RDV appartient au médecin connecté
    const { data: appt } = await supabaseService
      .from("appointments")
      .select("id, doctor_id, patient_phone, patient_name, requested_date, requested_time, status, ticket_token")
      .eq("id", appointmentId)
      .eq("doctor_id", user.id)
      .single();

    if (!appt) {
      return new Response(
        JSON.stringify({ error: "NOT_FOUND", message: "RDV introuvable ou accès refusé." }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (appt.status === "cancelled") {
      return new Response(
        JSON.stringify({ error: "ALREADY_CANCELLED", message: "Ce RDV est déjà annulé." }),
        { status: 409, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Annuler le RDV (invalider le ticket + bloquer le rappel)
    await supabaseService
      .from("appointments")
      .update({
        status:        "cancelled",
        reminder_sent: true,    // Bloque le cron pour éviter un rappel fantôme
        ticket_token:  null,    // Invalide le QR code
        cancel_token:  null,
      })
      .eq("id", appointmentId);

    // Charger le nom du médecin
    const { data: doctor } = await supabaseService
      .from("profiles")
      .select("first_name, last_name, clinic_name, is_clinic")
      .eq("id", user.id)
      .single();

    const doctorName = doctor?.is_clinic
      ? doctor.clinic_name
      : `Dr. ${doctor?.last_name ?? ""}`.trim();

    // Lien re-booking pré-rempli
    const rebookUrl = `${APP_URL}/book.html?doctor=${user.id}`;

    // SMS d'annulation au patient
    const date = new Date(appt.requested_date + "T00:00:00")
      .toLocaleDateString("fr-DZ", { weekday: "long", day: "numeric", month: "long" });
    const reasonText = reason ? `\nMotif : ${reason}` : "";
    const msg = `Docline - RDV annulé\n\nVotre RDV avec ${doctorName} du ${date} à ${appt.requested_time} a été annulé.${reasonText}\n\nReprenez RDV : ${rebookUrl}`;

    if (appt.patient_phone) {
      await sendSMS(appt.patient_phone, msg);
    }

    return new Response(
      JSON.stringify({ success: true, message: "RDV annulé et patient notifié par SMS." }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("cancel-appointment error:", e);
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", message: String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
