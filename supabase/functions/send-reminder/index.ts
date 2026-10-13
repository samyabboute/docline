import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";
import { sendMessage } from "../_shared/messaging.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = "https://docline.health";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Appel interne uniquement : même secret que la fonction notify (coffre Supabase)
  const admin0 = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: secret } = await admin0.rpc("_notify_secret");
  if (!secret || req.headers.get("x-notify-secret") !== secret) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fenêtre T-1h : RDV entre 55min et 65min dans le futur
    const now = Date.now();
    const from = new Date(now + 55 * 60 * 1000).toISOString();
    const to   = new Date(now + 65 * 60 * 1000).toISOString();

    const { data: appointments, error } = await supabase
      .from("appointments")
      .select(`
        id, patient_name, patient_phone, requested_date, requested_time,
        ticket_token, scheduled_at_ts,
        profiles:doctor_id ( first_name, last_name, clinic_name, is_clinic )
      `)
      .eq("status", "confirmed")
      .eq("reminder_sent", false)
      .gte("scheduled_at_ts", from)
      .lte("scheduled_at_ts", to);

    if (error) throw error;

    const results = [];
    for (const appt of appointments ?? []) {
      try {
        const doc = appt.profiles as any;
        const doctorName = doc?.is_clinic
          ? doc.clinic_name
          : `Dr. ${doc?.last_name ?? ""}`.trim();

        const date = new Date(appt.scheduled_at_ts).toLocaleDateString("fr-DZ", {
          day: "numeric", month: "long"
        });
        const ticketUrl = `${APP_URL}/ticket?t=${appt.ticket_token}`;

        const msg = `Docline : votre RDV avec ${doctorName} est dans 1 heure (${String(appt.requested_time).slice(0, 5)}). Votre ticket : ${ticketUrl}`;

        const sent = (await sendMessage(supabase, { to: appt.patient_phone, kind: "reminder", text: msg })).sent;
        if (sent) {
          await supabase
            .from("appointments")
            .update({ reminder_sent: true })
            .eq("id", appt.id);
          results.push({ id: appt.id, status: "sent" });
        } else {
          results.push({ id: appt.id, status: "failed" });
        }
      } catch (e) {
        console.error(`Reminder failed for appt ${appt.id}:`, e);
        results.push({ id: appt.id, status: "error", error: String(e) });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length, results }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("send-reminder error:", e);
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", message: String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
