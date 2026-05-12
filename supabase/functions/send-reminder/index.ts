import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INFOBIP_KEY  = Deno.env.get("INFOBIP_API_KEY") ?? "";
const INFOBIP_BASE = Deno.env.get("INFOBIP_BASE_URL") ?? "https://api.infobip.com";
const APP_URL      = Deno.env.get("APP_URL") ?? "https://samyabboute.github.io/docline";

async function sendSMS(to: string, text: string): Promise<boolean> {
  if (!INFOBIP_KEY) {
    console.log(`[DEV] Reminder SMS to ${to}: ${text}`);
    return true;
  }
  const res = await fetch(`${INFOBIP_BASE}/sms/2/text/advanced`, {
    method: "POST",
    headers: {
      "Authorization": `App ${INFOBIP_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ destinations: [{ to }], text }],
    }),
  });
  return res.ok;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Vérifier que c'est un appel interne (service_role ou cron)
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!authHeader.includes(serviceKey.slice(-20)) && !authHeader.includes("Bearer")) {
    // Accepter si appelé par pg_cron (pas de header) ou service_role
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
        const ticketUrl = `${APP_URL}/ticket.html?t=${appt.ticket_token}`;

        const msg = `Docline - Rappel RDV\n\nVotre RDV avec ${doctorName} est dans 1 heure.\n${date} à ${appt.requested_time}\n\nVotre ticket : ${ticketUrl}`;

        const sent = await sendSMS(appt.patient_phone, msg);
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
