// Invitations Docline (équipe Symphony, collaborateurs d'un établissement).
// Le lien de création de mot de passe est généré par Supabase, mais l'email part de Docline
// (Resend, noreply@docline.health) : même expéditeur et même présentation que nos autres emails,
// et pas de dépendance à l'expéditeur par défaut de Supabase (limité et souvent classé en indésirable).
import { button, layout, logEmail, para, sendEmail, SITE } from "./email.ts";

export type InviteKind = "symphony" | "clinic";

// deno-lint-ignore no-explicit-any
export async function sendInvite(admin: any, o: {
  email: string; name?: string | null; kind: InviteKind; orgName?: string | null; roleLabel?: string | null;
  inviter?: string | null; orgId?: string | null; triggeredBy?: string | null;
}): Promise<{ ok: boolean; mode: "invite" | "existing"; error?: string }> {
  const email = o.email.trim().toLowerCase();
  const parts = String(o.name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const meta: Record<string, unknown> = { first_name: first, last_name: parts.slice(1).join(" "), invited_to: o.kind };
  if (o.orgId) meta.invited_to_org = o.orgId;

  // 1. Lien d'invitation (crée le compte s'il n'existe pas)
  let mode: "invite" | "existing" = "invite";
  let link = `${SITE}/login`;
  const gen = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo: `${SITE}/login`, data: meta } });
  if (gen.error) {
    if (/already|registered|exists/i.test(gen.error.message)) mode = "existing";
    else return { ok: false, mode, error: gen.error.message };
  } else {
    link = gen.data?.properties?.action_link ?? link;
  }

  // 2. Email Docline
  // para() échappe le texte et met en gras ce qui est entre ** **
  const where = o.kind === "symphony" ? "Symphony, l’espace de pilotage de Docline" : (o.orgName ? `${o.orgName} sur Docline` : "Docline");
  const who = o.inviter ? `${o.inviter} vous a donné accès à ` : "Vous avez désormais accès à ";
  const role = o.roleLabel ? ` en tant que **${o.roleLabel}**` : "";
  const subject = o.kind === "symphony"
    ? (first ? `${first}, votre accès à Docline Symphony` : "Votre accès à Docline Symphony")
    : (o.orgName ? `${o.orgName} vous invite sur Docline` : "Votre invitation sur Docline");
  const body = mode === "invite"
    ? para(`${who}${where}${role}.`)
      + para("Pour commencer, choisissez votre mot de passe. Le lien est personnel et ne fonctionne qu’une seule fois.")
      + button("Créer mon mot de passe", link)
      + para(`Si le bouton ne fonctionne pas, demandez une nouvelle invitation à la personne qui vous a ajouté${o.kind === "symphony" ? "" : " dans l’équipe"}.`)
    : para(`${who}${where}${role}.`)
      + para("Vous avez déjà un compte Docline avec cette adresse : connectez-vous avec votre mot de passe habituel.")
      + button(o.kind === "symphony" ? "Ouvrir Symphony" : "Se connecter", `${SITE}/login`)
      + para(`Mot de passe oublié ? Utilisez « Mot de passe oublié » sur la page de connexion.`);
  const html = layout({
    eyebrow: o.kind === "symphony" ? "Équipe Docline" : "Invitation",
    preheader: mode === "invite" ? "Choisissez votre mot de passe pour accéder à votre espace." : "Votre accès est prêt.",
    title: first ? `Bienvenue, ${first}` : "Bienvenue",
    body,
    reason: "Vous recevez cet email parce qu’un responsable vous a ajouté à son équipe sur Docline.",
  });
  const sent = await sendEmail(email, subject, html);
  await logEmail({ type: o.kind === "symphony" ? "symphony_invite" : "team_invite", to: email, name: o.name ?? undefined, subject,
    status: sent ? "sent" : "failed", triggeredBy: o.triggeredBy ?? undefined, metadata: { mode, org: o.orgId ?? null } });
  return sent ? { ok: true, mode } : { ok: false, mode, error: "EMAIL_FAILED" };
}
