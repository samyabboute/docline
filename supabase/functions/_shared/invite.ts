// Invitations Docline : une seule procédure pour tout ajout de membre d'équipe
// (équipe Docline dans Symphony, personnel d'un établissement).
// L'email contient un lien unique (7 jours) vers docline.health/invitation/<jeton>.
// Le jeton n'est jamais stocké en clair (empreinte SHA-256). La suite (informations, mot de passe,
// code reçu par SMS et par email) est gérée par la fonction staff-onboarding.
import { button, layout, logEmail, para, sendEmail, SITE } from "./email.ts";

export type InviteKind = "symphony" | "clinic";

export async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// deno-lint-ignore no-explicit-any
export async function sendInvitation(admin: any, o: {
  kind: InviteKind; memberId: string; email: string; name?: string | null; orgId?: string | null; orgName?: string | null;
  roleLabel?: string | null; inviter?: string | null; invitedBy?: string | null; triggeredBy?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const email = o.email.trim().toLowerCase();
  const parts = String(o.name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";

  // Une seule invitation valable à la fois par membre
  await admin.from("staff_invitations").update({ status: "revoked", code_hash: null })
    .eq("member_id", o.memberId).in("status", ["pending", "code_sent"]);

  const token = randomToken();
  const { error } = await admin.from("staff_invitations").insert({
    token_hash: await sha256hex(token), kind: o.kind, member_id: o.memberId, org_id: o.orgId ?? null, email,
    first_name: first || null, last_name: parts.slice(1).join(" ") || null, role_label: o.roleLabel ?? null,
    org_name: o.kind === "symphony" ? "Docline" : (o.orgName ?? null), invited_by: o.invitedBy ?? null,
  });
  if (error) return { ok: false, error: error.message };

  const link = `${SITE}/invitation/${token}`;
  const where = o.kind === "symphony" ? "l’équipe Docline (Symphony)" : (o.orgName ? `l’équipe de ${o.orgName} sur Docline` : "une équipe sur Docline");
  const by = o.inviter ? `${o.inviter} vous invite à rejoindre ` : "Vous êtes invité à rejoindre ";
  const role = o.roleLabel ? ` en tant que **${o.roleLabel}**` : "";
  const subject = o.kind === "symphony"
    ? (first ? `${first}, activez votre accès à Docline Symphony` : "Activez votre accès à Docline Symphony")
    : (o.orgName ? `${o.orgName} vous invite sur Docline` : "Votre invitation sur Docline");
  const html = layout({
    eyebrow: o.kind === "symphony" ? "Équipe Docline" : "Invitation",
    preheader: "Activez votre accès en deux minutes : vos informations, votre mot de passe, un code de vérification.",
    title: first ? `Bienvenue, ${first}` : "Bienvenue",
    body: para(`${by}${where}${role}.`)
      + para("Pour activer votre accès, confirmez vos informations, choisissez votre mot de passe et saisissez le code que vous recevrez par SMS et par email.")
      + button("Activer mon accès", link)
      + para("Ce lien vous est personnel et reste valable 7 jours. Ne le transférez pas."),
    reason: "Vous recevez cet email parce qu’un responsable vous a ajouté à son équipe sur Docline. Si vous ne vous attendiez pas à cette invitation, ignorez simplement cet email.",
  });
  const sent = await sendEmail(email, subject, html);
  await logEmail({ type: o.kind === "symphony" ? "symphony_invite" : "team_invite", to: email, name: o.name ?? undefined, subject,
    status: sent ? "sent" : "failed", triggeredBy: o.triggeredBy ?? undefined, metadata: { member: o.memberId, org: o.orgId ?? null } });
  return sent ? { ok: true } : { ok: false, error: "EMAIL_FAILED" };
}
