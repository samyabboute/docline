// notify — emails transactionnels déclenchés par la base (pg_net) :
//   appointment_created  : nouvelle réservation (médecin + patient)
//   appointment_status   : confirmation / annulation (l'autre partie est prévenue)
//   patient_welcome      : un patient renseigne son email dans son espace
// Appel interne uniquement : l'en-tête x-notify-secret doit correspondre au
// secret stocké dans le coffre Supabase (vault, nom « notify_secret »).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { APP_URL, apptCard, button, details, esc, frDate, layout, link, logEmail, para, pill, sendEmail } from "../_shared/email.ts";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function doctorName(d: any): string {
  if (!d) return "votre médecin";
  if (d.is_clinic && d.clinic_name) return d.clinic_name;
  const n = [d.first_name, d.last_name].filter(Boolean).join(" ") || d.full_name || "";
  return n ? "Dr " + n.replace(/^dr\.?\s*/i, "") : "votre médecin";
}
function place(d: any): string {
  return [d?.address, d?.city, d?.wilaya].filter(Boolean).join(", ");
}
const t5 = (t: string) => String(t || "").slice(0, 5);

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: secret } = await admin.rpc("_notify_secret");
  if (!secret || req.headers.get("x-notify-secret") !== secret) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const event = String(body.event || "");

  // Une même notification n'est jamais envoyée deux fois.
  async function already(kind: string, key: string): Promise<boolean> {
    const { count } = await admin.from("email_logs").select("id", { count: "exact", head: true })
      .eq("type", kind).eq("status", "sent").contains("metadata", { key });
    return (count ?? 0) > 0;
  }
  async function deliver(kind: string, key: string, to: string | null | undefined, name: string, subject: string, html: string, replyTo?: string) {
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return "no_email";
    if (await already(kind, key)) return "duplicate";
    const ok = await sendEmail(to, subject, html, replyTo);
    await logEmail({ type: kind, to, name, subject, status: ok ? "sent" : "failed", triggeredBy: "notify", metadata: { key } });
    return ok ? "sent" : "failed";
  }

  // ── Bienvenue dans l'espace patient ─────────────────────────
  if (event === "patient_welcome") {
    const { data: p } = await admin.from("patients").select("id, full_name, email").eq("id", body.patient_id).maybeSingle();
    if (!p?.email) return json({ skipped: "no_email" });
    const first = String(p.full_name || "").trim().split(/\s+/)[0];
    const html = layout({
      preheader: "Vos rendez-vous, vos proches et vos résultats au même endroit.",
      title: first ? `Bienvenue, ${first}.` : "Bienvenue sur Docline.",
      body: para("Votre espace patient est prêt. Vous y retrouvez vos rendez-vous chez tous vos médecins, ceux de vos proches et les résultats que vos médecins vous transmettent.\n\nPour vous connecter, un code par SMS suffit : aucun mot de passe à retenir.")
        + button("Ouvrir mon espace", `${APP_URL}/patient`),
      reason: "Vous recevez cet email car vous avez ajouté cette adresse à votre espace patient Docline.",
    });
    const r = await deliver("patient_welcome", `welcome:${p.id}:${p.email}`, p.email, p.full_name || "", "Bienvenue dans votre espace Docline", html);
    return json({ result: r });
  }

  if (event !== "appointment_created" && event !== "appointment_status") return json({ error: "event" }, 400);

  const { data: a } = await admin.from("appointments")
    .select("id, doctor_id, patient_id, patient_name, patient_phone, patient_email, requested_date, requested_time, status, notes, ticket_token, cancelled_by")
    .eq("id", body.appointment_id).maybeSingle();
  if (!a) return json({ error: "not_found" }, 404);

  const { data: doc } = await admin.from("profiles")
    .select("id, email, first_name, last_name, full_name, is_clinic, clinic_name, address, city, wilaya, specialty, phone_public")
    .eq("id", a.doctor_id).maybeSingle();

  let patientEmail: string | null = a.patient_email || null;
  let hasAccount = false;
  if (a.patient_id) {
    const { data: pt } = await admin.from("patients").select("email, account_created_at").eq("id", a.patient_id).maybeSingle();
    if (!patientEmail && pt?.email) patientEmail = pt.email;
    hasAccount = !!pt?.account_created_at;
  }

  const dn = doctorName(doc);
  const when = `${frDate(a.requested_date)} à ${t5(a.requested_time)}`;
  const card = apptCard(a.requested_date, t5(a.requested_time), dn, [doc?.specialty, place(doc)].filter(Boolean).join(" · "));
  const patientCta = a.ticket_token
    ? button("Voir mon ticket", `${APP_URL}/ticket?t=${encodeURIComponent(a.ticket_token)}`)
    : button(hasAccount ? "Suivre dans mon espace" : "Suivre mon rendez-vous", `${APP_URL}/patient${hasAccount ? "#rdv" : "#signup"}`);
  const accountNudge = hasAccount ? "" : para("Créez votre espace patient gratuit pour retrouver ce rendez-vous, le déplacer ou l'annuler sans appeler le cabinet. Un code par SMS suffit.");
  const doctorCta = button("Ouvrir mes rendez-vous", `${APP_URL}/mes-rdv`);
  const out: Record<string, string> = {};

  // ── Nouvelle réservation ────────────────────────────────────
  if (event === "appointment_created") {
    const fromDoctor = body.source === "doctor";
    if (!fromDoctor) {
      const pending = a.status === "pending";
      out.doctor = await deliver("appt_doctor_new", `new:${a.id}`, doc?.email, dn,
        pending ? `Nouvelle demande de rendez-vous · ${a.patient_name}` : `Nouveau rendez-vous · ${a.patient_name}`,
        layout({
          preheader: `${a.patient_name}, ${when}`,
          title: pending ? "Nouvelle demande de rendez-vous" : "Nouveau rendez-vous confirmé",
          body: (pending ? pill("À confirmer", "wait") : pill("Confirmé", "ok"))
            + details([["Patient", a.patient_name], ["Date", frDate(a.requested_date)], ["Heure", t5(a.requested_time)], ["Téléphone", a.patient_phone], ["Motif", a.notes]])
            + para(pending
              ? "\nConfirmez ou proposez un autre créneau depuis votre agenda. Le patient est prévenu automatiquement."
              : "\nLe patient a vérifié son numéro par SMS et reçu son ticket. Son dossier est ajouté à votre liste de patients.")
            + doctorCta,
          reason: "Vous recevez cet email car un patient a réservé en ligne avec vous sur Docline.",
        }));
    }
    out.patient = await deliver("appt_patient_new", `new:${a.id}`, patientEmail, a.patient_name,
      a.status === "confirmed" ? `Rendez-vous confirmé · ${dn}` : `Demande envoyée · ${dn}`,
      layout({
        preheader: when,
        title: a.status === "confirmed" ? "Votre rendez-vous est confirmé" : "Votre demande est envoyée",
        body: (a.status === "confirmed" ? pill("Confirmé", "ok") : pill("En attente du cabinet", "wait"))
          + card
          + para(a.status === "confirmed"
            ? `\nPrésentez votre ticket à l'accueil. Merci de prévenir le cabinet si vous ne pouvez pas venir.`
            : `\n${dn} va confirmer votre rendez-vous. Vous recevrez un email dès que c'est fait.`)
          + patientCta + accountNudge,
        reason: "Vous recevez cet email car un rendez-vous a été réservé avec cette adresse sur Docline.",
      }));
    return json(out);
  }

  // ── Changement de statut ────────────────────────────────────
  const from = String(body.old_status || ""), to = String(body.new_status || a.status);
  if (to === "confirmed" && from === "pending") {
    out.patient = await deliver("appt_patient_confirmed", `confirmed:${a.id}`, patientEmail, a.patient_name, `Rendez-vous confirmé · ${dn}`,
      layout({
        preheader: `${dn} a confirmé : ${when}`,
        title: "Votre rendez-vous est confirmé",
        body: pill("Confirmé", "ok") + card
          + para(`\nÀ bientôt. Merci de prévenir le cabinet si vous ne pouvez pas venir : le créneau sera proposé à un autre patient.`)
          + patientCta + accountNudge,
        reason: "Vous recevez cet email car vous avez un rendez-vous sur Docline.",
      }));
  } else if (to === "cancelled" && from !== "cancelled") {
    if (a.cancelled_by === "patient") {
      out.doctor = await deliver("appt_doctor_cancelled", `cancelled:${a.id}`, doc?.email, dn, `Rendez-vous annulé par le patient · ${a.patient_name}`,
        layout({
          preheader: `${a.patient_name} a annulé : ${when}`,
          title: "Un patient a annulé",
          body: pill("Créneau libéré", "info")
            + details([["Patient", a.patient_name], ["Date", frDate(a.requested_date)], ["Heure", t5(a.requested_time)], ["Téléphone", a.patient_phone]])
            + para("\nLe créneau est de nouveau disponible à la réservation en ligne.") + doctorCta,
          reason: "Vous recevez cet email car un rendez-vous de votre agenda Docline a été annulé.",
        }));
    } else {
      out.patient = await deliver("appt_patient_cancelled", `cancelled:${a.id}`, patientEmail, a.patient_name, `Rendez-vous annulé · ${dn}`,
        layout({
          preheader: `Le cabinet a annulé votre rendez-vous du ${when}`,
          title: "Votre rendez-vous est annulé",
          body: pill("Annulé par le cabinet", "bad") + card
            + para(`\nNous sommes désolés pour ce contretemps. Vous pouvez choisir un nouveau créneau en quelques secondes.`)
            + button("Choisir un autre créneau", `${APP_URL}/book?doctor=${encodeURIComponent(a.doctor_id)}`)
            + (doc?.phone_public ? link(`Appeler le cabinet : ${doc.phone_public}`, `tel:${doc.phone_public}`) : ""),
          reason: "Vous recevez cet email car vous aviez un rendez-vous sur Docline.",
        }));
    }
  }
  return json(out);
});
