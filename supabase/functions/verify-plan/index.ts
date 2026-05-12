import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: CORS });

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan, status, current_period_end, cancel_at_period_end")
    .eq("user_id", user.id)
    .single();

  const { data: limitData } = await supabase.rpc("check_lead_limit", { p_user_id: user.id });
  const isPro = sub?.plan !== "free" && sub?.status === "active";

  return new Response(JSON.stringify({
    plan: sub?.plan ?? "free",
    status: sub?.status ?? "active",
    is_pro: isPro,
    period_end: sub?.current_period_end,
    cancel_at_period_end: sub?.cancel_at_period_end,
    limits: {
      leads_allowed: limitData?.allowed ?? true,
      leads_count: limitData?.count ?? 0,
      leads_limit: limitData?.limit ?? 10,
      invoices_enabled: isPro,
      team_enabled: sub?.plan === "team" && sub?.status === "active",
    }
  }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
});
