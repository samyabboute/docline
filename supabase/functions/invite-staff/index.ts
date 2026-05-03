import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { staffId, email, redirectTo } = await req.json()

    if (!staffId || !email) {
      return new Response(JSON.stringify({ error: 'staffId et email requis' }), { status: 400, headers: cors })
    }

    // Admin client (service role) — peut créer des utilisateurs
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Envoie un email d'invitation avec lien pour définir le mot de passe
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirectTo || 'https://samyabboute.github.io/docline/app.html',
    })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: cors })
    }

    // Lie l'user_id Supabase Auth au membre du personnel
    await admin
      .from('staff')
      .update({ user_id: data.user.id })
      .eq('id', staffId)

    return new Response(JSON.stringify({ ok: true }), { headers: cors })

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors })
  }
})
