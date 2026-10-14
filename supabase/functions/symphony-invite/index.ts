// symphony-invite : envoie (ou renvoie) l'invitation d'un membre de l'équipe Docline (Symphony).
// Réservé aux personnes autorisées à gérer l'équipe ; le membre doit déjà figurer dans symphony_staff.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendInvite } from '../_shared/invite.ts'

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
    const { data: allowed } = await asUser.rpc('symphony_can', { p_perm: 'team.manage' })
    if (allowed !== true) return json({ error: 'FORBIDDEN' }, 403)

    const { email } = await req.json().catch(() => ({}))
    const target = String(email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) return json({ error: 'EMAIL_INVALID' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: m } = await admin.from('symphony_staff').select('email, full_name, title, is_active').ilike('email', target).maybeSingle()
    if (!m) return json({ error: 'NOT_A_MEMBER', message: 'Ajoutez d’abord cette personne à l’équipe.' }, 404)
    if (!m.is_active) return json({ error: 'INACTIVE', message: 'Ce membre est désactivé. Réactivez-le avant de l’inviter.' }, 409)

    const { data: me } = await admin.from('symphony_staff').select('full_name').ilike('email', user.email ?? '').maybeSingle()
    const r = await sendInvite(admin, { email: target, name: m.full_name, kind: 'symphony', roleLabel: m.title || null,
      inviter: me?.full_name || null, triggeredBy: user.email ?? null })
    if (!r.ok) return json({ error: 'SEND_FAILED', message: 'L’email n’a pas pu partir : ' + (r.error ?? 'erreur inconnue') }, 502)
    return json({ ok: true, mode: r.mode })
  } catch (e) {
    return json({ error: 'INTERNAL_ERROR', message: String((e as Error)?.message ?? e) }, 500)
  }
})
