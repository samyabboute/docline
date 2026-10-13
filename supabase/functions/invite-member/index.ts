// invite-member : invitation d'un collaborateur (secrétaire, infirmier, laboratoire, comptabilité,
// administrateur, médecin) dans un établissement. Seul un membre autorisé à gérer l'équipe peut
// inviter, uniquement une fiche de SON établissement, à l'adresse enregistrée sur la fiche.
// Si la personne a déjà un compte Docline, l'accès s'active à sa prochaine connexion
// (workspace_init rapproche l'adresse email).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    const { data: m } = await admin.from('org_members').select('id, org_id, email, full_name, user_id, status').eq('id', memberId).maybeSingle()
    if (!m || m.org_id !== orgId) return json({ error: 'FORBIDDEN' }, 403)
    const email = String(m.email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'EMAIL_MISSING', message: 'Ajoutez une adresse email valide avant d’inviter.' }, 400)
    if (m.user_id || m.status !== 'invited') return json({ error: 'ALREADY_ACTIVE', message: 'Cette personne a déjà accès.' }, 409)

    // Limite : 20 invitations par établissement et par jour
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { count } = await admin.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', orgId).gte('invited_at', since)
    if ((count ?? 0) >= 20) return json({ error: 'DAILY_LIMIT', message: 'Limite de 20 invitations par jour atteinte.' }, 429)

    const parts = String(m.full_name ?? '').trim().split(/\s+/)
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: 'https://docline.health/login',
      data: { first_name: parts[0] ?? '', last_name: parts.slice(1).join(' '), invited_to_org: orgId },
    })
    let existing = false
    if (error) {
      if (/already|registered|exists/i.test(error.message)) existing = true
      else return json({ error: 'INVITE_FAILED', message: error.message }, 400)
    }
    await admin.from('org_members').update({ invited_at: new Date().toISOString() }).eq('id', memberId)
    return json({ ok: true, existing })
  } catch (e) {
    return json({ error: 'INTERNAL_ERROR', message: String((e as Error)?.message ?? e) }, 500)
  }
})
