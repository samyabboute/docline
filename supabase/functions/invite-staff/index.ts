// invite-staff : ancienne invitation du personnel (table staff), remplacée par invite-member
// et la procédure d'activation staff-onboarding. Désactivée pour qu'il n'existe qu'un seul parcours.
const cors = {
  'Access-Control-Allow-Origin': 'https://docline.health',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  return new Response(JSON.stringify({ error: 'GONE', message: 'Les invitations se font depuis Équipe et accès.' }),
    { status: 410, headers: { ...cors, 'Content-Type': 'application/json' } })
})
