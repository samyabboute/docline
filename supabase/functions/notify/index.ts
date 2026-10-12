// notify — emails transactionnels déclenchés par la base (pg_net) :
//   appointment_created  : nouvelle réservation (médecin + patient)
//   appointment_status   : confirmation / annulation (l'autre partie est prévenue)
//   patient_welcome      : un patient renseigne son email dans son espace
//   kyc_status, payment_request, payment_recorded, extension_approved, account_status : médecins
//   appointment_reminders (veille du RDV), trial_reminders (J-3 et dernier jour) : appelés par pg_cron
//   email_test           : test de réception vers les boîtes @docline.health uniquement
// Appel interne uniquement : l'en-tête x-notify-secret doit correspondre au
// secret stocké dans le coffre Supabase (vault, nom « notify_secret »).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { amount, APP_URL, apptCard, button, details, esc, frDate, layout, link, logEmail, para, pill, sendEmail } from "../_shared/email.ts";

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

  // ════════ Médecins : vérification, paiements, compte ════════
  const DA = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0)).replace(/ | /g, " ") + " DA";
  const PLAN: Record<string, string> = { pro: "Pro", clinic: "Clinique", enterprise: "Clinique", free: "Gratuit" };
  const METHOD: Record<string, string> = { virement: "Virement bancaire", ccp: "Versement CCP", baridimob: "BaridiMob", cib: "Carte CIB", edahabia: "Edahabia", especes: "Espèces", cash: "Espèces", cheque: "Chèque", chargily: "Paiement en ligne", autre: "Autre" };
  async function doctor(id: string) {
    const { data } = await admin.from("profiles").select("id, email, first_name, last_name, full_name, is_clinic, clinic_name, kyc_status, kyc_reject_reason, kyc_reviewed_at, kyc_submitted_at, is_active, payment_deadline, specialty, wilaya").eq("id", id).maybeSingle();
    return data;
  }
  const hello = (d: any) => d?.is_clinic && d?.clinic_name ? d.clinic_name : (d?.last_name ? "Dr " + d.last_name : doctorName(d));
  const BILLING_REPLY = "facturation@docline.health";

  // ── Test de réception : uniquement vers les boîtes @docline.health ──
  if (event === "email_test") {
    const BOXES: Record<string, string> = {
      "contact@docline.health": "Adresse générale : réponses aux emails automatiques et messages des visiteurs.",
      "support@docline.health": "Aide aux médecins : questions sur le cabinet, l'agenda et les ordonnances.",
      "facturation@docline.health": "Paiements, reçus et factures : les médecins y répondent depuis leurs emails de paiement.",
      "privacy@docline.health": "Données personnelles : demandes d'accès, de rectification ou de suppression (loi 18-07).",
      "legal@docline.health": "Questions juridiques et contrats.",
      "samy@docline.health": "Adresse personnelle du fondateur.",
    };
    const run = new Date().toISOString();
    const out: Record<string, string> = {};
    for (const to of (Array.isArray(body.to) ? body.to : Object.keys(BOXES))) {
      if (!BOXES[to]) { out[to] = "refusé"; continue; }
      const replyTo = to === "facturation@docline.health" ? "facturation@docline.health" : undefined;
      out[to] = await deliver("email_test", `test:${to}:${run}`, to, "Équipe Docline", "Test de réception : " + to,
        layout({ eyebrow: "Test", preheader: "Cette boîte reçoit bien les emails Docline.", title: "Cette boîte fonctionne",
          body: pill("Email de test", "info")
            + para(`Cet email confirme que ${to} reçoit bien les envois de Docline.

${BOXES[to]}`)
            + apptCard(new Date(Date.now() + 86400000).toISOString().slice(0, 10), "10:30", "Exemple de rendez-vous", "Aperçu d'une carte de rendez-vous, telle que la reçoivent les patients")
            + amount("4 900 DA", "Exemple de montant, tel qu'il apparaît sur un reçu")
            + button("Ouvrir Docline", APP_URL),
          reason: "Vous recevez cet email car un test de réception a été lancé depuis Docline." }), replyTo);
    }
    return json({ result: out });
  }

  if (event === "kyc_status") {
    const d = await doctor(body.doctor_id);
    if (!d) return json({ skipped: "no_doctor" });
    const st = String(body.status || d.kyc_status);
    if (st === "pending_review") {
      return json({ result: await deliver("kyc_received", `kyc:recv:${d.id}:${d.kyc_submitted_at}`, d.email, hello(d), "Votre dossier de vérification est bien reçu",
        layout({ eyebrow: "Vérification", preheader: "Notre équipe vérifie vos documents.", title: "Dossier bien reçu",
          body: para(`Merci ${hello(d)}. Notre équipe vérifie vos documents.\n\nVous recevrez un email dès que la vérification est terminée. En attendant, vous pouvez déjà utiliser votre agenda et vos dossiers patients.`)
            + button("Ouvrir mon cabinet", `${APP_URL}/dashboard`),
          reason: "Vous recevez cet email car vous avez envoyé un document de vérification sur Docline." })) });
    }
    if (st === "approved") {
      return json({ result: await deliver("kyc_approved", `kyc:ok:${d.id}:${d.kyc_reviewed_at}`, d.email, hello(d), "Votre identité est vérifiée",
        layout({ eyebrow: "Vérification", preheader: "Votre cabinet peut maintenant recevoir des patients en ligne.", title: "Votre identité est vérifiée",
          body: pill("Vérifié", "ok")
            + para(`Bonne nouvelle, ${hello(d)}. Votre compte est vérifié.\n\nDès que votre spécialité et votre wilaya sont renseignées, votre page apparaît dans l'annuaire Docline et les patients peuvent réserver avec vous.`)
            + button("Compléter mon profil public", `${APP_URL}/profil-public`) + link("Ouvrir mon cabinet", `${APP_URL}/dashboard`),
          reason: "Vous recevez cet email car votre dossier de vérification Docline a été traité." })) });
    }
    if (st === "rejected") {
      return json({ result: await deliver("kyc_rejected", `kyc:ko:${d.id}:${d.kyc_reviewed_at}`, d.email, hello(d), "Votre dossier de vérification est à compléter",
        layout({ eyebrow: "Vérification", preheader: "Il manque un élément pour vérifier votre identité.", title: "Votre dossier est à compléter",
          body: para(`${hello(d)}, nous n'avons pas pu valider votre document pour la raison suivante.`)
            + details([["Motif", d.kyc_reject_reason || "Document non conforme"]])
            + para("\nEnvoyez un nouveau document depuis votre cabinet : la vérification reprend aussitôt.")
            + button("Envoyer un nouveau document", `${APP_URL}/dashboard`),
          reason: "Vous recevez cet email car votre dossier de vérification Docline a été traité." })) });
    }
    return json({ skipped: st });
  }

  if (event === "payment_request" ) {
    const { data: r } = await admin.from("payment_requests").select("*").eq("id", body.request_id).maybeSingle();
    if (!r) return json({ skipped: "no_request" });
    const d = await doctor(r.user_id);
    const to = d?.email || r.user_email;
    if (r.status === "pending") {
      return json({ result: await deliver("payment_received", `pay:recv:${r.id}`, to, hello(d), "Nous avons bien reçu votre demande de paiement",
        layout({ eyebrow: "Facturation", preheader: "Votre abonnement sera activé dès la réception du paiement.", title: "Demande de paiement reçue",
          body: (r.amount ? amount(DA(r.amount), `Abonnement ${PLAN[r.plan] || r.plan}, ${r.billing === "yearly" ? "annuel" : "mensuel"}`) : "")
            + details([["Moyen de paiement", METHOD[r.method] || r.method], ["Référence", r.reference], ["Date", frDate(r.created_at)]])
            + para("\nVotre abonnement est activé dès que notre équipe a constaté le paiement. Vous recevrez alors un reçu par email."),
          reason: "Vous recevez cet email car une demande de paiement a été faite depuis votre compte Docline." }), BILLING_REPLY) });
    }
    if (r.status === "rejected") {
      return json({ result: await deliver("payment_rejected", `pay:ko:${r.id}`, to, hello(d), "Votre paiement n'a pas pu être validé",
        layout({ eyebrow: "Facturation", preheader: "Nous n'avons pas pu rapprocher votre paiement.", title: "Paiement non validé",
          body: pill("Non validé", "bad")
            + details([["Montant", r.amount ? DA(r.amount) : null], ["Moyen de paiement", METHOD[r.method] || r.method], ["Référence", r.reference], ["Date de la demande", frDate(r.created_at)]])
            + para("\nNous n'avons pas pu rapprocher ce paiement. Répondez simplement à cet email avec votre justificatif : notre équipe facturation vous répond rapidement."),
          reason: "Vous recevez cet email au sujet d'une demande de paiement de votre compte Docline." }), BILLING_REPLY) });
    }
    return json({ skipped: r.status });
  }

  if (event === "payment_recorded") {
    const { data: e } = await admin.from("billing_entries").select("*").eq("id", body.entry_id).maybeSingle();
    if (!e || e.kind !== "payment") return json({ skipped: "not_payment" });
    const d = await doctor(e.doctor_id);
    const { data: sub } = await admin.from("subscriptions").select("plan, interval, expires_at").eq("user_id", e.doctor_id).maybeSingle();
    return json({ result: await deliver("payment_receipt", `receipt:${e.id}`, d?.email, hello(d), `Reçu de paiement ${e.number}`,
      layout({ eyebrow: "Reçu", preheader: `Paiement de ${DA(e.amount_da)} bien reçu.`, title: "Merci, votre paiement est reçu",
        body: amount(DA(e.amount_da), e.label)
          + details([["Pièce", e.number], ["Date", frDate(e.created_at)], ["Moyen de paiement", METHOD[e.method] || e.method], ["Référence", e.external_ref],
                     ["Abonnement", sub?.plan && sub.plan !== "free" ? `${PLAN[sub.plan] || sub.plan}${sub.expires_at ? ", jusqu'au " + frDate(sub.expires_at) : ""}` : null]])
          + para("\nConservez cet email : il vaut reçu. Votre relevé de compte complet est disponible sur demande.")
          + button("Ouvrir mon cabinet", `${APP_URL}/dashboard`),
        reason: "Vous recevez cet email car un paiement a été enregistré sur votre compte Docline." }), BILLING_REPLY) });
  }

  if (event === "extension_approved") {
    const { data: x } = await admin.from("billing_extensions").select("*").eq("id", body.extension_id).maybeSingle();
    if (!x || x.status !== "approved") return json({ skipped: "not_approved" });
    const d = await doctor(x.doctor_id);
    return json({ result: await deliver("deadline_extended", `ext:${x.id}`, d?.email, hello(d), "Votre échéance de paiement est prolongée",
      layout({ eyebrow: "Facturation", preheader: `Nouvelle échéance : ${frDate(x.new_due)}.`, title: "Échéance prolongée",
        body: para(`${hello(d)}, votre demande de délai est acceptée.`)
          + details([["Nouvelle échéance", frDate(x.new_due)], ["Ancienne échéance", x.old_due ? frDate(x.old_due) : null]])
          + para("\nVotre accès reste actif jusqu'à cette date. Pour toute question, répondez simplement à cet email."),
        reason: "Vous recevez cet email au sujet de la facturation de votre compte Docline." }), BILLING_REPLY) });
  }

  if (event === "account_status") {
    const d = await doctor(body.doctor_id);
    if (!d) return json({ skipped: "no_doctor" });
    if (d.is_active === false) {
      const { data: log } = await admin.from("kyc_audit_log").select("note, created_at").eq("doctor_id", d.id).eq("action", "deactivated").order("created_at", { ascending: false }).limit(1).maybeSingle();
      return json({ result: await deliver("account_suspended", `susp:${d.id}:${log?.created_at || ""}`, d.email, hello(d), "Votre compte Docline est suspendu",
        layout({ eyebrow: "Votre compte", preheader: "Votre page n'est plus visible et la réservation en ligne est fermée.", title: "Compte suspendu",
          body: para(`${hello(d)}, votre compte Docline est suspendu. Votre page n'apparaît plus dans l'annuaire et la réservation en ligne est fermée. Vos données sont conservées.`)
            + details([["Motif", log?.note || null]])
            + para("\nPour réactiver votre compte, répondez à cet email : notre équipe vous indique la marche à suivre."),
          reason: "Vous recevez cet email au sujet de votre compte Docline." }), BILLING_REPLY) });
    }
    return json({ result: await deliver("account_reactivated", `react:${d.id}:${new Date().toISOString().slice(0, 13)}`, d.email, hello(d), "Votre compte Docline est réactivé",
      layout({ eyebrow: "Votre compte", preheader: "Bon retour sur Docline.", title: "Votre compte est réactivé",
        body: pill("Actif", "ok") + para(`Bon retour, ${hello(d)}. Votre cabinet est de nouveau accessible et vos patients peuvent réserver en ligne.`)
          + button("Ouvrir mon cabinet", `${APP_URL}/dashboard`),
        reason: "Vous recevez cet email au sujet de votre compte Docline." })) });
  }

  // ════════ Envois planifiés (pg_cron) ════════
  if (event === "appointment_reminders") {
    const tomorrow = new Date(Date.now() + 86400000 + 3600000).toISOString().slice(0, 10);   // demain, heure d'Alger
    const { data: list } = await admin.from("appointments")
      .select("id, doctor_id, patient_id, patient_name, patient_email, requested_date, requested_time, status, ticket_token")
      .eq("requested_date", tomorrow).eq("status", "confirmed").limit(500);
    let sent = 0;
    for (const a of list || []) {
      let email = a.patient_email;
      if (!email && a.patient_id) { const { data: pt } = await admin.from("patients").select("email").eq("id", a.patient_id).maybeSingle(); email = pt?.email; }
      if (!email) continue;
      const { data: doc } = await admin.from("profiles").select("first_name, last_name, full_name, is_clinic, clinic_name, address, city, wilaya, specialty, phone_public").eq("id", a.doctor_id).maybeSingle();
      const dn = doctorName(doc);
      const r = await deliver("appt_reminder", `remind:${a.id}`, email, a.patient_name, `Rappel : votre rendez-vous demain à ${t5(a.requested_time)}`,
        layout({ eyebrow: "Rappel", preheader: `${dn}, demain à ${t5(a.requested_time)}.`, title: "À demain",
          body: para(`Bonjour ${String(a.patient_name || "").split(" ")[0]}, nous vous rappelons votre rendez-vous.`)
            + apptCard(a.requested_date, t5(a.requested_time), dn, [doc?.specialty, place(doc)].filter(Boolean).join(", "))
            + para("\nSi vous ne pouvez pas venir, prévenez le cabinet : le créneau sera proposé à un autre patient.")
            + (a.ticket_token ? button("Voir mon ticket", `${APP_URL}/ticket?t=${encodeURIComponent(a.ticket_token)}`) : button("Gérer mon rendez-vous", `${APP_URL}/patient#rdv`))
            + (doc?.phone_public ? link(`Appeler le cabinet : ${doc.phone_public}`, `tel:${doc.phone_public}`) : ""),
          reason: "Vous recevez cet email car vous avez un rendez-vous demain sur Docline." }));
      if (r === "sent") sent++;
    }
    return json({ reminders: sent });
  }

  if (event === "trial_reminders") {
    const now = Date.now();
    const { data: subs } = await admin.from("subscriptions").select("user_id, plan, trial_end_date, expires_at, payment_status")
      .eq("payment_status", "pending").neq("plan", "free").not("trial_end_date", "is", null)
      .lte("trial_end_date", new Date(now + 3.5 * 86400000).toISOString()).gte("trial_end_date", new Date(now).toISOString()).limit(500);
    let sent = 0;
    for (const s of subs || []) {
      const d = await doctor(s.user_id);
      const daysLeft = Math.max(0, Math.round((new Date(s.trial_end_date).getTime() - now) / 86400000));
      const stage = daysLeft <= 1 ? "last" : "j3";
      const r = await deliver("trial_expiring", `trial:${stage}:${s.user_id}:${String(s.trial_end_date).slice(0, 10)}`, d?.email, hello(d),
        stage === "last" ? "Votre essai Docline se termine aujourd'hui" : `Votre essai Docline se termine dans ${daysLeft} jours`,
        layout({ eyebrow: "Votre essai", preheader: `Fin de l'essai le ${frDate(s.trial_end_date)}.`,
          title: stage === "last" ? "Votre essai se termine aujourd'hui" : `Plus que ${daysLeft} jours d'essai`,
          body: para(`${hello(d)}, votre essai de la formule ${PLAN[s.plan] || s.plan} se termine le ${frDate(s.trial_end_date)}.\n\nPour garder votre agenda en ligne, vos rappels et votre salle d'attente sans interruption, choisissez votre formule. Vos patients et vos données restent intacts.`)
            + button("Choisir ma formule", `${APP_URL}/pricing`),
          reason: "Vous recevez cet email car vous profitez d'un essai Docline." }), BILLING_REPLY);
      if (r === "sent") sent++;
    }
    return json({ trial_reminders: sent });
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
