import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "contact@docline.health";

// ── Actions and their minimum required role ────────────────────
const ACTION_ROLES: Record<string, string[]> = {
  // L1+ (all staff)
  "get_staff_profile":   ["l1", "l2", "l3", "super_admin"],
  // L2+
  "approve_kyc":         ["l2", "l3", "super_admin"],
  "reject_kyc":          ["l2", "l3", "super_admin"],
  "approve_payment":     ["l2", "l3", "super_admin"],
  "reject_payment":      ["l2", "l3", "super_admin"],
  "set_plan":            ["l2", "l3", "super_admin"],
  "grant_access":        ["l2", "l3", "super_admin"],
  // L3+ ONLY — requires employee_id confirmation
  "delete_user":         ["l3", "super_admin"],
  "suspend_user":        ["l3", "super_admin"],
  "export_data":         ["l3", "super_admin"],
  // super_admin only
  "add_staff":           ["super_admin"],
  "remove_staff":        ["super_admin"],
  "update_staff":        ["super_admin"],
};

// Actions requiring employee_id confirmation (L3 gate)
const L3_ACTIONS = new Set(["delete_user", "suspend_user", "export_data"]);

// Severity mapping for audit log
const ACTION_SEVERITY: Record<string, string> = {
  "delete_user":    "critical",
  "suspend_user":   "critical",
  "export_data":    "elevated",
  "remove_staff":   "elevated",
  "approve_payment":"normal",
  "reject_payment": "normal",
  "set_plan":       "normal",
  "approve_kyc":    "normal",
  "reject_kyc":     "normal",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return new Response(
    JSON.stringify({ error: "UNAUTHORIZED" }),
    { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
  );

  try {
    // ── Authenticate caller ──────────────────────────────────────
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return new Response(
      JSON.stringify({ error: "UNAUTHORIZED" }),
      { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
    );

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Load caller's staff profile ──────────────────────────────
    let callerStaff: { employee_id: string; role: string; full_name: string; is_active: boolean } | null = null;

    // Super admin bypass (owner email)
    if (user.email === ADMIN_EMAIL) {
      const { data: ownerRow } = await admin
        .from("symphony_staff")
        .select("employee_id, role, full_name, is_active")
        .eq("email", ADMIN_EMAIL)
        .maybeSingle();
      callerStaff = ownerRow ?? { employee_id: "EMP-000001", role: "super_admin", full_name: "Super Admin", is_active: true };
    } else {
      const { data: staffRow } = await admin
        .from("symphony_staff")
        .select("employee_id, role, full_name, is_active")
        .eq("email", user.email!)
        .maybeSingle();
      if (!staffRow || !staffRow.is_active) {
        return new Response(
          JSON.stringify({ error: "FORBIDDEN", message: "Accès Symphony refusé" }),
          { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
      callerStaff = staffRow;
    }

    const body = await req.json();
    const { action, employeeId, targetId, targetEmail, payload } = body;

    if (!action) return new Response(
      JSON.stringify({ error: "MISSING_ACTION" }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );

    // ── get_staff_profile — special case (no role check needed) ──
    if (action === "get_staff_profile") {
      return new Response(
        JSON.stringify({ ok: true, staff: callerStaff }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ── Role check ───────────────────────────────────────────────
    const allowedRoles = ACTION_ROLES[action];
    if (!allowedRoles) return new Response(
      JSON.stringify({ error: "UNKNOWN_ACTION" }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );

    if (!allowedRoles.includes(callerStaff.role)) {
      return new Response(
        JSON.stringify({
          error: "INSUFFICIENT_ROLE",
          message: `Action '${action}' requiert le rôle ${allowedRoles[0].toUpperCase()}. Votre rôle : ${callerStaff.role.toUpperCase()}`
        }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ── L3 employee_id confirmation ───────────────────────────────
    if (L3_ACTIONS.has(action)) {
      if (!employeeId) return new Response(
        JSON.stringify({ error: "EMPLOYEE_ID_REQUIRED", message: "Numéro employé obligatoire pour cette action" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
      // Verify the employeeId matches the authenticated caller
      if (employeeId.trim().toUpperCase() !== callerStaff.employee_id.toUpperCase()) {
        // Log failed attempt
        await admin.from("symphony_audit_log").insert({
          employee_id: callerStaff.employee_id,
          employee_name: callerStaff.full_name,
          action: action,
          severity: "critical",
          target_type: "user",
          target_id: targetId ?? null,
          target_email: targetEmail ?? null,
          details: { error: "wrong_employee_id", provided: employeeId },
          ip_address: req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null,
        }).catch(() => {});
        return new Response(
          JSON.stringify({ error: "INVALID_EMPLOYEE_ID", message: "Numéro employé incorrect" }),
          { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
    }

    const now = new Date().toISOString();
    let result: Record<string, unknown> = {};

    // ── Execute action ────────────────────────────────────────────

    if (action === "delete_user") {
      if (!targetId) throw new Error("targetId required");

      // 1. Delete all related data
      await admin.from("symphony_audit_log").delete().eq("target_id", targetId);
      await admin.from("kyc_audit_log").delete().eq("doctor_id", targetId);
      await admin.from("subscriptions").delete().eq("user_id", targetId);
      await admin.from("profiles").delete().eq("id", targetId);
      // 2. Delete from Supabase Auth
      const { error: authErr } = await admin.auth.admin.deleteUser(targetId);
      if (authErr) throw new Error("Auth delete failed: " + authErr.message);

      result = { deleted: true };

    } else if (action === "suspend_user") {
      if (!targetId) throw new Error("targetId required");
      await admin.from("profiles").update({ is_active: false, is_public: false }).eq("id", targetId);
      await admin.from("subscriptions").update({ status: "paused" }).eq("user_id", targetId);
      result = { suspended: true };

    } else if (action === "add_staff") {
      const { email, fullName, department, role: newRole } = payload ?? {};
      if (!email || !fullName || !department) throw new Error("email, fullName, department requis");
      // Generate employee_id
      const { data: empIdRow } = await admin.rpc("generate_employee_id").single().catch(() => ({ data: null }));
      const newEmpId = empIdRow ?? ("EMP-" + String(Date.now()).slice(-6));
      const { error: insertErr } = await admin.from("symphony_staff").insert({
        email, employee_id: newEmpId,
        full_name: fullName,
        department,
        role: newRole || "l1",
      });
      if (insertErr) throw new Error("Insert staff failed: " + insertErr.message);
      // Also add to admin_roles for admin panel access
      await admin.from("admin_roles").upsert({ email, role: newRole || "l1" }, { onConflict: "email" }).catch(() => {});
      result = { employee_id: newEmpId };

    } else if (action === "remove_staff") {
      const { email: targetStaffEmail } = payload ?? {};
      if (!targetStaffEmail) throw new Error("email requis");
      await admin.from("symphony_staff").update({ is_active: false }).eq("email", targetStaffEmail);
      await admin.from("admin_roles").delete().eq("email", targetStaffEmail);
      result = { removed: true };

    } else if (action === "update_staff") {
      const { staffId, updates } = payload ?? {};
      if (!staffId) throw new Error("staffId requis");
      const allowed = ["full_name", "department", "role", "is_active", "notes"];
      const safeUpdates: Record<string, unknown> = {};
      for (const k of allowed) if (updates[k] !== undefined) safeUpdates[k] = updates[k];
      await admin.from("symphony_staff").update(safeUpdates).eq("id", staffId);
      result = { updated: true };
    }

    // ── Write audit log ───────────────────────────────────────────
    await admin.from("symphony_audit_log").insert({
      employee_id:   callerStaff.employee_id,
      employee_name: callerStaff.full_name,
      action,
      severity:      ACTION_SEVERITY[action] ?? "normal",
      target_type:   "user",
      target_id:     targetId ?? null,
      target_email:  targetEmail ?? null,
      details:       { ...result, ...( payload ? { payload } : {} ) },
      ip_address:    req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null,
      user_agent:    req.headers.get("user-agent") ?? null,
      created_at:    now,
    }).catch(() => {});

    return new Response(
      JSON.stringify({ ok: true, ...result }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("symphony-action error:", e);
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", message: String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
