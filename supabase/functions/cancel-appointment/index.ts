import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMessage } from "../_shared/messaging.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = "https://docline.health";

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
    const rebookUrl = `${APP_URL}/book?doctor=${user.id}`;

    // SMS d'annulation au patient
    const date = new Date(appt.requested_date + "T00:00:00")
      .toLocaleDateString("fr-DZ", { weekday: "long", day: "numeric", month: "long" });
    const reasonText = reason ? ` Motif : ${String(reason).slice(0, 80)}.` : "";
    const msg = `Docline : votre RDV avec ${doctorName} du ${date} a ${String(appt.requested_time).slice(0, 5)} est annule.${reasonText} Reprendre RDV : ${rebookUrl}`;

    // SMS au patient (l'email part aussi, par la fonction notify) ; la nuit, seul l'email part
    let smsSent = false;
    if (appt.patient_phone) {
      smsSent = (await sendMessage(supabaseService, { to: appt.patient_phone, kind: "cancellation", text: msg, doctorId: user.id })).sent;
    }

    return new Response(
      JSON.stringify({ success: true, sms: smsSent, message: smsSent ? "RDV annulé, patient prévenu par SMS." : "RDV annulé." }),
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
