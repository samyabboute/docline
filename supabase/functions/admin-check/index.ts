// ============================================================
// PROSPEO — Admin Access Gate Edge Function
// Deploy: supabase functions deploy admin-check
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const ADMIN_IDS = (Deno.env.get("ADMIN_USER_IDS") ?? "").split(",").map(s=>s.trim()).filter(Boolean);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: CORS });

  const isAdmin = ADMIN_IDS.includes(user.id);
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await svc.from("audit_log").insert({
    user_id: user.id,
    event: isAdmin ? "admin.access_granted" : "admin.access_denied",
    metadata: { email: user.email }
  });
  if (!isAdmin) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: CORS });
  return new Response(JSON.stringify({ admin: true, user_id: user.id }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
});
