// invite-staff : invitation d'un membre du personnel (secrétaire, infirmier…) par le cabinet.
// Seul le titulaire du cabinet peut inviter, uniquement un membre de SON personnel, et
// uniquement à l'adresse enregistrée sur la fiche. Le lien renvoie toujours vers docline.health.
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

    const { staffId } = await req.json().catch(() => ({}))
    if (!staffId) return json({ error: 'staffId requis' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: member } = await admin.from('staff').select('id, clinic_id, email, user_id').eq('id', staffId).maybeSingle()
    if (!member || member.clinic_id !== user.id) return json({ error: 'FORBIDDEN' }, 403)
    const email = String(member.email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'EMAIL_MISSING', message: 'Ajoutez une adresse email valide sur la fiche avant d’inviter.' }, 400)
    if (member.user_id) return json({ error: 'ALREADY_INVITED', message: 'Ce membre a déjà un accès.' }, 409)

    // Limite : 20 invitations par cabinet et par jour
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { count } = await admin.from('staff').select('id', { count: 'exact', head: true }).eq('clinic_id', user.id).gte('invited_at', since)
    if ((count ?? 0) >= 20) return json({ error: 'DAILY_LIMIT', message: 'Limite de 20 invitations par jour atteinte.' }, 429)

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: 'https://docline.health/login' })
    if (error) return json({ error: 'INVITE_FAILED', message: error.message }, 400)

    await admin.from('staff').update({ user_id: data.user.id, invited_at: new Date().toISOString() }).eq('id', staffId)
    return json({ ok: true })
  } catch (e) {
    return json({ error: 'INTERNAL_ERROR', message: String((e as Error)?.message ?? e) }, 500)
  }
})
