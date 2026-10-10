import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Permission Symphony exigée pour chaque action (vérifiée côté serveur avec le jeton de l'agent)
const ACTION_PERM: Record<string, string> = {
  approve: "kyc.decide", reject: "kyc.decide",
  set_plan: "doctors.edit", toggle_active: "doctors.edit", deactivate: "doctors.edit",
  approve_payment: "payments.decide", reject_payment: "payments.decide",
  delete_user: "users.sensitive",
};

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

    const { doctorId, action, note, interval, adminGrant } = await req.json();
    if (!doctorId || !action) {
      return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const perm = ACTION_PERM[action];
    if (!perm) return new Response(JSON.stringify({ error: "UNKNOWN_ACTION" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    const { data: allowed } = await supa.rpc("symphony_can", { p_perm: perm });
    if (allowed !== true) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
    const now   = new Date().toISOString();
    const log = (a: string, n: unknown = null) =>
      admin.from("kyc_audit_log").insert({ doctor_id: doctorId, action: a, reviewer_id: user.id, note: n ?? null });

    if (action === "approve" || action === "reject") {
      // Même règle que la page KYC : le serveur décide, identifie le vérificateur et tient le journal
      const { data, error } = await supa.rpc("kyc_decide", {
        p_doctor: doctorId, p_decision: action === "approve" ? "approved" : "rejected", p_reason: note ?? null,
      });
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ ok: true, ...data }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });

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
        if (existingSub) {
          const { error: subErr } = await admin.from("subscriptions")
            .update({ plan: "free", status: "active", invoice_notes: null })
            .eq("user_id", doctorId);
          if (subErr) throw new Error("subscriptions downgrade failed: " + subErr.message);
        }
      } else {
        // Upgrade to pro/clinic
        // If adminGrant: mark as paid with invoice_notes='admin_grant'
        const subInterval = interval || "month";
        const subPaymentStatus = adminGrant ? "paid" : "pending";
        const subNotes = adminGrant ? "admin_grant" : null;

        // Compute expiry for admin grants
        let expiresAt: string | null = null;
        if (adminGrant) {
          const exp = new Date();
          if (subInterval === "year") exp.setFullYear(exp.getFullYear() + 1);
          else exp.setMonth(exp.getMonth() + 1);
          expiresAt = exp.toISOString();
        }

        if (existingSub) {
          const updatePayload: Record<string, unknown> = {
            plan: note, status: "active",
            interval: subInterval,
            payment_status: subPaymentStatus,
            invoice_notes: subNotes,
          };
          if (expiresAt) updatePayload.expires_at = expiresAt;
          if (adminGrant) updatePayload.paid_at = now;
          const { error: subErr } = await admin.from("subscriptions").update(updatePayload).eq("user_id", doctorId);
          if (subErr) throw new Error("subscriptions update failed: " + subErr.message);
        } else {
          const insertPayload: Record<string, unknown> = {
            user_id: doctorId, plan: note, status: "active",
            interval: subInterval,
            payment_status: subPaymentStatus,
            invoice_notes: subNotes,
            created_at: now,
          };
          if (expiresAt) insertPayload.expires_at = expiresAt;
          if (adminGrant) insertPayload.paid_at = now;
          const { error: subErr } = await admin.from("subscriptions").insert(insertPayload);
          if (subErr) throw new Error("subscriptions insert failed: " + subErr.message);
        }
      }
      await log("set_plan", note);

    } else if (action === "toggle_active") {
      const { data: p } = await admin.from("profiles").select("is_active").eq("id", doctorId).single();
      const newVal = !(p?.is_active ?? true);
      await admin.from("profiles").update({ is_active: newVal }).eq("id", doctorId);
      await log(newVal ? "activated" : "deactivated");

    } else if (action === "deactivate") {
      // Force-deactivate: always sets is_active=false AND is_public=false (no toggle risk)
      await admin.from("profiles").update({ is_active: false, is_public: false }).eq("id", doctorId);
      await admin.from("subscriptions").update({ status: "suspended" }).eq("user_id", doctorId);
      await log("deactivated", note);

    } else if (action === "approve_payment") {
      const now2 = new Date().toISOString();
      const { data: sub } = await admin.from("subscriptions")
        .select("interval,created_at")
        .eq("user_id", doctorId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(null, () => ({ data: null }));
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
      await log("approve_payment", note);

    } else if (action === "reject_payment") {
      const { error: subErr2 } = await admin.from("subscriptions").update({
        payment_status: 'failed',
      }).eq("user_id", doctorId);
      if (subErr2) throw new Error("Payment rejection failed: " + subErr2.message);
      await log("reject_payment", note);

    } else if (action === "delete_user") {
      // Un compte qui porte un historique de paiement n'est jamais supprimé : on le désactive.
      const { count: paid } = await admin.from("subscriptions").select("id", { count: "exact", head: true })
        .eq("user_id", doctorId).not("paid_at", "is", null);
      const { count: requests } = await admin.from("payment_requests").select("id", { count: "exact", head: true })
        .eq("user_id", doctorId);
      if ((paid ?? 0) > 0 || (requests ?? 0) > 0) {
        return new Response(JSON.stringify({ error: "HAS_FINANCIAL_RECORDS", message: "Ce compte a un historique de paiement : désactivez-le au lieu de le supprimer." }),
          { status: 409, headers: { ...CORS, "Content-Type": "application/json" } });
      }
      // Trace de la suppression, conservée après l'effacement du compte
      const { data: target } = await admin.from("profiles").select("email,full_name").eq("id", doctorId).maybeSingle();
      const { data: actor } = await admin.from("symphony_staff").select("id,full_name").ilike("email", user.email ?? "").maybeSingle();
      await admin.from("org_events").insert({ actor_id: actor?.id ?? null, actor_name: actor?.full_name ?? user.email, kind: "doctor_deleted",
        detail: { doctor_id: doctorId, email: target?.email ?? null, name: target?.full_name ?? null, reason: note ?? null } });
      await admin.from("profiles").delete().eq("id", doctorId);
      // 2. Delete from Supabase Auth (frees the email for re-registration)
      const { error: authErr } = await admin.auth.admin.deleteUser(doctorId);
      if (authErr) throw new Error("auth delete failed: " + authErr.message);

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
