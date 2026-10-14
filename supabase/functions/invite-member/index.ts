// invite-member : invitation d'un collaborateur (secrétaire, infirmier, laboratoire, comptabilité,
// administrateur, médecin) dans un établissement. Seul un membre autorisé à gérer l'équipe peut
// inviter, uniquement une fiche de SON établissement, à l'adresse enregistrée sur la fiche.
// L'email contient un lien unique : la personne confirme ses informations, choisit son mot de passe
// et valide un code reçu par SMS et par email (fonction staff-onboarding) ; l'accès s'ouvre ensuite.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendInvitation } from '../_shared/invite.ts'

const cors = {
  'Access-Control-Allow-Origin': 'https://docline.health',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const auth = req.headers.get('Authorization') ?? ''
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await asUser.auth.getUser()
    if (!user) return json({ error: 'UNAUTHORIZED' }, 401)

    const { orgId, memberId } = await req.json().catch(() => ({}))
    if (!orgId || !memberId) return json({ error: 'BAD_REQUEST' }, 400)

    // Droit vérifié par la base, avec l'identité de l'appelant
    const { data: allowed } = await asUser.rpc('org_can', { p_org: orgId, p_perm: 'team.manage' })
    if (allowed !== true) return json({ error: 'FORBIDDEN' }, 403)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: m } = await admin.from('org_members').select('id, org_id, email, full_name, user_id, status, role').eq('id', memberId).maybeSingle()
    if (!m || m.org_id !== orgId) return json({ error: 'FORBIDDEN' }, 403)
    const email = String(m.email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'EMAIL_MISSING', message: 'Ajoutez une adresse email valide avant d’inviter.' }, 400)
    if (m.user_id || m.status !== 'invited') return json({ error: 'ALREADY_ACTIVE', message: 'Cette personne a déjà accès.' }, 409)

    // Limite : 20 invitations par établissement et par jour
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { count } = await admin.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', orgId).gte('invited_at', since)
    if ((count ?? 0) >= 20) return json({ error: 'DAILY_LIMIT', message: 'Limite de 20 invitations par jour atteinte.' }, 429)

    const ROLE: Record<string, string> = { admin: 'Administration', doctor: 'Médecin', secretary: 'Secrétariat', nurse: 'Soins infirmiers', lab: 'Laboratoire', accountant: 'Comptabilité' }
    const { data: org } = await admin.from('profiles').select('clinic_name, last_name, full_name').eq('id', orgId).maybeSingle()
    const orgName = (org?.clinic_name || '').trim() || (org ? 'Cabinet du Dr ' + (org.last_name || org.full_name || '') : 'Docline')
    const { data: inviter } = await admin.from('profiles').select('first_name, last_name, full_name').eq('id', user.id).maybeSingle()
    const inviterName = inviter ? ([inviter.first_name, inviter.last_name].filter(Boolean).join(' ') || inviter.full_name || null) : null
    const r = await sendInvitation(admin, { kind: 'clinic', memberId: m.id, email, name: m.full_name, orgId, orgName, roleLabel: ROLE[m.role] ?? null,
      inviter: inviterName, invitedBy: user.id, triggeredBy: user.email ?? null })
    if (!r.ok) return json({ error: 'INVITE_FAILED', message: 'L’email n’a pas pu partir : ' + (r.error ?? 'erreur inconnue') }, 502)
    await admin.from('org_members').update({ invited_at: new Date().toISOString() }).eq('id', memberId)
    return json({ ok: true, existing: false })
  } catch (e) {
    return json({ error: 'INTERNAL_ERROR', message: String((e as Error)?.message ?? e) }, 500)
  }
})
