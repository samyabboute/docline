import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "samyabboute5@gmail.com";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401, headers: CORS });

  try {
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Allow super_admin or any admin_roles entry
    if (user.email !== ADMIN_EMAIL) {
      const { data: roleRow } = await admin.from("admin_roles").select("role").eq("email", user.email).single();
      if (!roleRow) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const { doctorId, action, note } = await req.json();
    // action: "approve" | "reject" | "set_plan" | "toggle_active"
    if (!doctorId || !action) {
      return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const now   = new Date().toISOString();

    if (action === "approve") {
      await admin.from("profiles").update({
        kyc_status:      "approved",
        kyc_reviewed_at: now,
        kyc_reviewer_id: user.id,
        kyc_reject_reason: null,
      }).eq("id", doctorId);
      await admin.from("kyc_audit_log").insert({ doctor_id: doctorId, action: "approved", note: note ?? null });

    } else if (action === "reject") {
      await admin.from("profiles").update({
        kyc_status:        "rejected",
        kyc_reviewed_at:   now,
        kyc_reviewer_id:   user.id,
        kyc_reject_reason: note ?? "Document non valide.",
      }).eq("id", doctorId);
      await admin.from("kyc_audit_log").insert({ doctor_id: doctorId, action: "rejected", note: note ?? null });

    } else if (action === "set_plan") {
      const { plan } = await req.json().catch(() => ({}));
      await admin.from("profiles").update({ plan: note }).eq("id", doctorId);
      await admin.from("kyc_audit_log").insert({ doctor_id: doctorId, action: `set_plan:${note}`, note: null });

    } else if (action === "toggle_active") {
      const { data: p } = await admin.from("profiles").select("is_active").eq("id", doctorId).single();
      const newVal = !(p?.is_active ?? true);
      await admin.from("profiles").update({ is_active: newVal }).eq("id", doctorId);
      await admin.from("kyc_audit_log").insert({ doctor_id: doctorId, action: newVal ? "activated" : "deactivated", note: null });

    } else {
      return new Response(JSON.stringify({ error: "UNKNOWN_ACTION" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("admin-kyc-action error:", e);
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR", message: String(e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
});
