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
    console.log(`[DEV] SMS to ${to}: ${text}`);
    return;
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Infobip error: ${err}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    // Vérifie que c'est bien le médecin propriétaire du RDV
    const supaDoc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );
    const { data: { user } } = await supaDoc.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { appointmentId } = await req.json();
    if (!appointmentId) {
      return new Response(JSON.stringify({ error: "MISSING_APPOINTMENT_ID" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Charger le RDV (avec vérification ownership)
    const { data: appt, error: apptErr } = await supa
      .from("appointments")
      .select("id, doctor_id, patient_name, patient_phone, requested_date, requested_time, status, confirmation_token, patient_confirmed")
      .eq("id", appointmentId)
      .eq("doctor_id", user.id)
      .single();

    if (apptErr || !appt) {
      return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
        status: 404, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (!appt.patient_phone) {
      return new Response(JSON.stringify({ error: "NO_PHONE", message: "Ce patient n'a pas de numéro de téléphone." }), {
        status: 422, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (appt.patient_confirmed) {
      return new Response(JSON.stringify({ error: "ALREADY_CONFIRMED", message: "Ce patient a déjà confirmé sa présence." }), {
        status: 409, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Charger le médecin
    const { data: doctor } = await supa
      .from("profiles")
      .select("full_name, first_name, last_name, clinic_name, is_clinic")
      .eq("id", user.id)
      .single();

    const doctorName = doctor?.full_name
      || (doctor?.is_clinic ? doctor?.clinic_name : `Dr. ${doctor?.last_name ?? ""}`.trim())
      || "votre médecin";

    // Lien de confirmation patient
    const confirmUrl = `${APP_URL}/confirm.html?token=${appt.confirmation_token}`;

    // Formater la date en français
    const dateObj = new Date(appt.requested_date + "T00:00:00");
    const jours = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
    const mois  = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];
    const dateFr = `${jours[dateObj.getDay()]} ${dateObj.getDate()} ${mois[dateObj.getMonth()]}`;

    const smsText =
      `Docline - Rappel RDV\n\n` +
      `Bonjour ${appt.patient_name},\n` +
      `Votre RDV avec ${doctorName} est le ${dateFr} à ${appt.requested_time}.\n\n` +
      `Confirmez votre présence :\n${confirmUrl}\n\n` +
      `Pour annuler, répondez STOP.`;

    await sendSMS(appt.patient_phone, smsText);

    // Marquer SMS envoyé
    await supa
      .from("appointments")
      .update({ sms_confirmation_sent: true })
      .eq("id", appointmentId);

    return new Response(JSON.stringify({ ok: true, message: "SMS envoyé avec succès." }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("send-appointment-sms error:", e);
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR", message: String(e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
