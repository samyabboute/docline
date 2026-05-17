import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";

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
    // action: "approve" | "reject" | "set_plan" | "toggle_active" | "deactivate"
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
      // 1. Update profiles.plan
      const { error: profErr } = await admin.from("profiles").update({ plan: note }).eq("id", doctorId);
      if (profErr) throw new Error("profiles update failed: " + profErr.message);

      // 2. Upsert subscriptions (the doctor app reads this at login)
      // Check for an existing row (use array to avoid .single() throwing on 0 rows)
      const { data: subRows } = await admin
        .from("subscriptions").select("id,status")
        .eq("user_id", doctorId)
        .order("created_at", { ascending: false }).limit(1);
      const existingSub = subRows && subRows.length > 0 ? subRows[0] : null;

      if (note === "free") {
        // Downgrade: just update plan to 'free', keep existing status
        // (avoids CHECK constraint issues with 'canceled' variants)
        if (existingSub) {
          const { error: subErr } = await admin.from("subscriptions")
            .update({ plan: "free", status: "active" })
            .eq("user_id", doctorId);
          if (subErr) throw new Error("subscriptions downgrade failed: " + subErr.message);
        }
        // no existing row + free → nothing to do
      } else {
        // Upgrade to pro/clinic
        if (existingSub) {
          const { error: subErr } = await admin.from("subscriptions")
            .update({ plan: note, status: "active" })
            .eq("user_id", doctorId);
          if (subErr) throw new Error("subscriptions update failed: " + subErr.message);
        } else {
          const { error: subErr } = await admin.from("subscriptions").insert({
            user_id: doctorId, plan: note, status: "active", created_at: now,
          });
          if (subErr) throw new Error("subscriptions insert failed: " + subErr.message);
        }
      }
      try { await admin.from("kyc_audit_log").insert({ doctor_id: doctorId, action: "set_plan", note: note ?? null }); } catch (_) {}

    } else if (action === "toggle_active") {
      const { data: p } = await admin.from("profiles").select("is_active").eq("id", doctorId).single();
      const newVal = !(p?.is_active ?? true);
      await admin.from("profiles").update({ is_active: newVal }).eq("id", doctorId);
      await admin.from("kyc_audit_log").insert({ doctor_id: doctorId, action: newVal ? "activated" : "deactivated", note: null });

    } else if (action === "deactivate") {
      // Force-deactivate: always sets is_active=false AND is_public=false (no toggle risk)
      await admin.from("profiles").update({ is_active: false, is_public: false }).eq("id", doctorId);
      await admin.from("subscriptions").update({ status: "suspended" }).eq("user_id", doctorId);
      await admin.from("kyc_audit_log").insert({ doctor_id: doctorId, action: "deactivated", note: note ?? null });

    } else if (action === "approve_payment") {
      const now2 = new Date().toISOString();
      const { data: sub } = await admin.from("subscriptions")
        .select("interval,created_at")
        .eq("user_id", doctorId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
        .catch(() => ({ data: null }));
      const interval = sub?.interval || 'month';
      const startDate = sub?.created_at ? new Date(sub.created_at) : new Date();
      const endDate = new Date(startDate);
      if (interval === 'year') endDate.setFullYear(endDate.getFullYear() + 1);
      else endDate.setMonth(endDate.getMonth() + 1);

      const { error: subErr } = await admin.from("subscriptions").update({
        payment_status: 'paid',
        payment_method: note || 'transfer',
        paid_at: now2,
        expires_at: endDate.toISOString(),
        status: 'active',
      }).eq("user_id", doctorId);
      if (subErr) throw new Error("Payment approval failed: " + subErr.message);
      await admin.from("profiles").update({ is_active: true }).eq("id", doctorId);
      try { await admin.from("kyc_audit_log").insert({ doctor_id: doctorId, action: "approve_payment", note: note ?? null }); } catch(_) {}

    } else if (action === "reject_payment") {
      const { error: subErr2 } = await admin.from("subscriptions").update({
        payment_status: 'failed',
      }).eq("user_id", doctorId);
      if (subErr2) throw new Error("Payment rejection failed: " + subErr2.message);
      try { await admin.from("kyc_audit_log").insert({ doctor_id: doctorId, action: "reject_payment", note: note ?? null }); } catch(_) {}

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
