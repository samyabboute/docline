import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401, headers: CORS });

  try {
    const SUPER_ADMIN = Deno.env.get("ADMIN_EMAIL") ?? "samyabboute5@gmail.com";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Verify caller is admin
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });

    if (user.email !== SUPER_ADMIN) {
      const { data: roleRow } = await admin.from("admin_roles").select("role").eq("email", user.email).single();
      if (!roleRow) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const { target_user_id, plan, billing = "monthly", months = 1, is_trial = false } = await req.json();

    if (!target_user_id || !plan) {
      return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Accept 'pro' and 'clinic' (schema allows free/pro/clinic)
    const validPlans = ["free", "pro", "clinic"];
    if (!validPlans.includes(plan)) {
      return new Response(JSON.stringify({ error: "INVALID_PLAN" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const now = new Date();
    const trialEnd = new Date(now);
    if (plan !== "free") trialEnd.setMonth(trialEnd.getMonth() + Number(months));

    // trial_end is the correct column name (schema: trial_end timestamptz)
    const upsertData: Record<string, unknown> = {
      user_id:    target_user_id,
      plan,
      status:     is_trial ? "trialing" : (plan === "free" ? "active" : "active"),
      updated_at: now.toISOString(),
    };

    if (plan !== "free") {
      upsertData.trial_end         = trialEnd.toISOString();
      upsertData.current_period_start = now.toISOString();
      upsertData.current_period_end   = trialEnd.toISOString();
    } else {
      upsertData.trial_end = null;
    }

    // billing column may not exist in schema — only set if provided and plan is paid
    if (plan !== "free" && billing) {
      upsertData.billing = billing;
    }

    const { error } = await admin.from("subscriptions").upsert(upsertData, { onConflict: "user_id" });
    if (error) throw error;

    // Auto-send trial_granted email when a trial is activated (best-effort)
    if (is_trial && plan !== "free") {
      try {
        const SEND_EMAIL_URL = Deno.env.get("SUPABASE_URL")! + "/functions/v1/send-email";
        await fetch(SEND_EMAIL_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${jwt}`,
          },
          body: JSON.stringify({ type: "trial_granted", payload: {} }),
        });
      } catch (_) { /* non-blocking */ }
    }

    return new Response(
      JSON.stringify({ ok: true, expires_at: trialEnd.toISOString() }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("activate-plan error:", e);
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", message: String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
