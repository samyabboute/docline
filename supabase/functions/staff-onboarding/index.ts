// staff-onboarding : activation d'un membre d'équipe à partir de son lien d'invitation.
//   info   → ce que la page affiche (prénom, nom, email, équipe, rôle, compte existant ou non)
//   start  → enregistre prénom, nom, téléphone ; envoie le même code à 6 chiffres par SMS et par email
//   verify → vérifie le code, crée le compte (mot de passe) ou rattache le compte existant, ouvre l'accès
// Aucun accès n'est ouvert avant la vérification du code. Le jeton et le code ne sont stockés qu'en empreinte.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sha256hex } from '../_shared/invite.ts'
import { guardMessage, ipHashFrom, normalizePhone, sendMessage } from '../_shared/messaging.ts'
import { layout, logEmail, para, sendEmail, SITE } from '../_shared/email.ts'

const cors = {
  'Access-Control-Allow-Origin': 'https://docline.health',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const err = (code: string, message: string, s = 400) => json({ error: code, message }, s)

const GUARD_CODES = new Set(['PAUSED', 'BLOCKED_NUMBER', 'INVALID_NUMBER', 'COUNTRY_NOT_ALLOWED', 'TOO_FAST', 'NUMBER_HOURLY', 'NUMBER_DAILY', 'IP_HOURLY', 'IP_DAILY', 'GLOBAL_HOURLY', 'GLOBAL_DAILY'])
const CODE_TTL_MIN = 10, MAX_ATTEMPTS = 5, MAX_CODES = 6, COOLDOWN_S = 60

function maskPhone(p: string) { return p.slice(0, 4) + ' ' + '•'.repeat(Math.max(0, p.length - 7)) + ' ' + p.slice(-3) }
function maskEmail(e: string) { const [u, d] = e.split('@'); return (u.length <= 2 ? u[0] + '•' : u.slice(0, 2) + '•'.repeat(Math.min(6, u.length - 2))) + '@' + d }
function nameOk(s: unknown) { const t = String(s ?? '').trim(); return t.length >= 2 && t.length <= 60 && !/[<>{}\d]/.test(t) }
// Même règle que le projet d'authentification : 10 caractères, minuscule, majuscule, chiffre, caractère spécial
function passwordOk(p: unknown) { const s = String(p ?? ''); return s.length >= 10 && s.length <= 128 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && /[^A-Za-z0-9]/.test(s) }
// Mot de passe présent dans des fuites connues (Have I Been Pwned, k-anonymat : seuls 5 caractères de l'empreinte partent)
async function pwned(p: string): Promise<boolean> {
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(p))
    const h = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000)
    const r = await fetch('https://api.pwnedpasswords.com/range/' + h.slice(0, 5), { signal: ctl.signal, headers: { 'Add-Padding': 'true' } })
    clearTimeout(t)
    if (!r.ok) return false
    const rest = h.slice(5)
    return (await r.text()).split(/\r?\n/).some((l) => l.startsWith(rest + ':') && !l.trim().endsWith(':0'))
  } catch { return false }
}
function sameText(a: string, b: string) {   // comparaison à temps constant
  if (a.length !== b.length) return false
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return err('METHOD', 'Méthode non autorisée.', 405)
  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    const token = String(body.token ?? '')
    if (!/^[A-Za-z0-9_-]{30,64}$/.test(token)) return err('INVALID_LINK', 'Ce lien d’invitation n’est pas valide.', 404)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: inv } = await admin.from('staff_invitations').select('*').eq('token_hash', await sha256hex(token)).maybeSingle()
    if (!inv || inv.status === 'revoked') return err('INVALID_LINK', 'Ce lien n’est plus valable. Une invitation plus récente a peut-être été envoyée : utilisez le dernier email reçu.', 404)
    if (inv.status === 'accepted') return json({ error: 'ALREADY_ACCEPTED', message: 'Votre accès est déjà activé. Connectez-vous avec votre email et votre mot de passe.', email: inv.email }, 409)
    if (new Date(inv.expires_at) < new Date()) return err('EXPIRED', 'Ce lien a expiré. Demandez une nouvelle invitation à la personne qui vous a ajouté.', 410)

    // Le membre doit toujours exister et ne pas avoir été retiré ou désactivé
    let member: Record<string, unknown> | null = null
    if (inv.kind === 'symphony') {
      const { data } = await admin.from('symphony_staff').select('id, email, full_name, title, is_active, activated_at').eq('id', inv.member_id).maybeSingle()
      member = data && data.is_active && String(data.email).toLowerCase() === inv.email ? data : null
    } else {
      const { data } = await admin.from('org_members').select('id, org_id, email, full_name, status, user_id').eq('id', inv.member_id).maybeSingle()
      member = data && data.status === 'invited' && !data.user_id && String(data.email ?? '').toLowerCase() === inv.email ? data : null
    }
    if (!member) return err('MEMBER_GONE', 'Cette invitation a été annulée par l’équipe. Contactez la personne qui vous a ajouté.', 410)

    const { data: existingId } = await admin.rpc('_auth_user_id_by_email', { p_email: inv.email })
    const existing = !!existingId

    // ── info ──
    if (action === 'info') {
      return json({
        kind: inv.kind, email: inv.email, first_name: inv.first_name, last_name: inv.last_name,
        org_name: inv.kind === 'symphony' ? 'Équipe Docline' : inv.org_name, role_label: inv.role_label,
        existing, status: inv.status, phone_hint: inv.phone ? maskPhone(inv.phone) : null, expires_at: inv.expires_at,
      })
    }

    // ── start : informations confirmées, envoi du code ──
    if (action === 'start') {
      if (!nameOk(body.first_name) || !nameOk(body.last_name)) return err('NAME_INVALID', 'Vérifiez votre prénom et votre nom.')
      const phone = normalizePhone(String(body.phone ?? ''))
      if (!phone) return err('PHONE_INVALID', 'Numéro de mobile invalide. Exemple : 0555 12 34 56, ou +33 6 12 34 56 78 depuis l’étranger.')
      if (!existing) {
        if (!passwordOk(body.password)) return err('PASSWORD_WEAK', 'Mot de passe trop faible : 10 caractères minimum, avec une majuscule, une minuscule, un chiffre et un caractère spécial.')
        if (await pwned(String(body.password))) return err('PASSWORD_PWNED', 'Ce mot de passe figure dans des fuites de données connues. Choisissez-en un autre, propre à Docline.')
      }
      if (inv.codes_sent >= MAX_CODES) return err('TOO_MANY_CODES', 'Trop de codes envoyés pour cette invitation. Demandez une nouvelle invitation.', 429)
      if (inv.last_code_at && Date.now() - new Date(inv.last_code_at).getTime() < COOLDOWN_S * 1000) {
        const wait = COOLDOWN_S - Math.floor((Date.now() - new Date(inv.last_code_at).getTime()) / 1000)
        return json({ error: 'COOLDOWN', message: `Patientez ${wait} s avant de demander un nouveau code.`, wait }, 429)
      }
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0')
      const first = String(body.first_name).trim(), last = String(body.last_name).trim()
      await admin.from('staff_invitations').update({
        first_name: first, last_name: last, phone, status: 'code_sent',
        code_hash: await sha256hex(inv.id + ':' + code), code_expires_at: new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString(),
        code_attempts: 0, codes_sent: inv.codes_sent + 1, last_code_at: new Date().toISOString(),
      }).eq('id', inv.id)

      const sms = await sendMessage(admin, { to: phone, kind: 'staff_code', scope: 'staff', ipHash: await ipHashFrom(req),
        text: `Docline : votre code d'activation est ${code}. Valable ${CODE_TTL_MIN} minutes. Ne le communiquez a personne.` })
      const subject = `Votre code d’activation Docline : ${code}`
      const html = layout({
        eyebrow: inv.kind === 'symphony' ? 'Équipe Docline' : 'Activation',
        preheader: `Code ${code}, valable ${CODE_TTL_MIN} minutes.`,
        title: code,
        body: para(`Bonjour ${first}, voici votre code d’activation. Le même code vient de vous être envoyé par SMS.`)
          + para(`Il est valable **${CODE_TTL_MIN} minutes**. Ne le communiquez à personne : l’équipe Docline ne vous le demandera jamais.`),
        reason: 'Vous recevez cet email parce que vous activez votre accès à Docline.',
      })
      const mail = await sendEmail(inv.email, subject, html)
      await logEmail({ type: 'staff_activation_code', to: inv.email, name: `${first} ${last}`, subject: 'Code d’activation Docline', status: mail ? 'sent' : 'failed', metadata: { invitation: inv.id } })
      if (!sms.sent && !mail) return err('SEND_FAILED', sms.error && GUARD_CODES.has(sms.error) ? guardMessage(sms.error) : 'Le code n’a pas pu être envoyé. Vérifiez votre numéro et réessayez dans un instant.', 502)
      return json({ ok: true, sms: sms.sent, sms_error: sms.sent ? null : guardMessage(sms.error), email: mail, phone_hint: maskPhone(phone), email_hint: maskEmail(inv.email), ttl_min: CODE_TTL_MIN, cooldown: COOLDOWN_S })
    }

    // ── verify : code, création ou rattachement du compte, ouverture de l'accès ──
    if (action === 'verify') {
      if (inv.status !== 'code_sent' || !inv.code_hash) return err('NO_CODE', 'Demandez d’abord votre code.')
      if (!inv.code_expires_at || new Date(inv.code_expires_at) < new Date()) return err('CODE_EXPIRED', 'Ce code a expiré. Demandez un nouveau code.', 410)
      if (inv.code_attempts >= MAX_ATTEMPTS) return err('TOO_MANY_ATTEMPTS', 'Trop d’essais. Demandez un nouveau code.', 429)
      const code = String(body.code ?? '').replace(/\D/g, '')
      if (code.length !== 6 || !sameText(await sha256hex(inv.id + ':' + code), inv.code_hash)) {
        const left = MAX_ATTEMPTS - inv.code_attempts - 1
        await admin.from('staff_invitations').update({ code_attempts: inv.code_attempts + 1 }).eq('id', inv.id)
        return json({ error: 'CODE_WRONG', message: left > 0 ? `Code incorrect. Il vous reste ${left} essai${left > 1 ? 's' : ''}.` : 'Code incorrect. Demandez un nouveau code.', left }, 400)
      }

      let userId = existingId as string | null
      if (!userId) {
        if (!passwordOk(body.password)) return err('PASSWORD_WEAK', 'Mot de passe trop faible : 10 caractères minimum, avec une majuscule, une minuscule, un chiffre et un caractère spécial.')
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email: inv.email, password: String(body.password), email_confirm: true,
          user_metadata: { first_name: inv.first_name, last_name: inv.last_name, full_name: `${inv.first_name} ${inv.last_name}`, phone: inv.phone, invited_to: inv.kind },
        })
        if (cErr || !created?.user) {
          if (/password/i.test(cErr?.message ?? '')) return err('PASSWORD_WEAK', 'Ce mot de passe est refusé (' + (cErr?.message ?? '') + '). Choisissez-en un autre.')
          return err('ACCOUNT_FAILED', 'Le compte n’a pas pu être créé. Réessayez dans un instant.', 500)
        }
        userId = created.user.id
        await admin.from('profiles').update({ first_name: inv.first_name, last_name: inv.last_name, phone: inv.phone }).eq('id', userId)
      }

      const fullName = `${inv.first_name} ${inv.last_name}`.trim()
      if (inv.kind === 'symphony') {
        const { error: uErr } = await admin.from('symphony_staff').update({ full_name: fullName, phone: inv.phone, activated_at: new Date().toISOString() }).eq('id', inv.member_id)
        if (uErr) return err('LINK_FAILED', 'L’accès n’a pas pu être ouvert. Réessayez.', 500)
      } else {
        const { data: linked, error: uErr } = await admin.from('org_members').update({ user_id: userId, status: 'active', joined_at: new Date().toISOString(), full_name: fullName, phone: inv.phone })
          .eq('id', inv.member_id).eq('status', 'invited').select('id')
        if (uErr || !linked?.length) return err('LINK_FAILED', 'L’accès n’a pas pu être ouvert. Réessayez.', 500)
      }
      await admin.from('staff_invitations').update({ status: 'accepted', accepted_at: new Date().toISOString(), user_id: userId, code_hash: null }).eq('id', inv.id)

      // Confirmation par email (trace pour la personne, utile si ce n'était pas elle)
      const where = inv.kind === 'symphony' ? 'Symphony' : (inv.org_name || 'votre équipe')
      const html = layout({
        eyebrow: 'Accès activé', preheader: 'Votre accès Docline est prêt.', title: 'Tout est en ordre',
        body: para(`Bonjour ${inv.first_name}, votre accès à ${where} est activé. Connectez-vous avec cet email et ${existing ? 'votre mot de passe habituel' : 'le mot de passe que vous venez de choisir'}.`)
          + para(`Si vous n’êtes pas à l’origine de cette activation, répondez à cet email immédiatement.`),
        reason: 'Message de sécurité envoyé à chaque activation de compte.',
      })
      await sendEmail(inv.email, 'Votre accès Docline est activé', html)
      return json({ ok: true, email: inv.email, kind: inv.kind, existing, login: `${SITE}/login?email=${encodeURIComponent(inv.email)}` })
    }

    return err('ACTION', 'Action inconnue.')
  } catch (e) {
    return err('INTERNAL_ERROR', String((e as Error)?.message ?? e), 500)
  }
})
