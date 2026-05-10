import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPER_ADMIN = Deno.env.get("ADMIN_EMAIL") ?? "samyabboute5@gmail.com";

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

    // Only super_admin can manage users
    const isSuperAdmin = user.email === SUPER_ADMIN;
    if (!isSuperAdmin) {
      const { data: roleRow } = await admin.from("admin_roles").select("role").eq("email", user.email).single();
      if (!roleRow || roleRow.role !== "super_admin") {
        return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
      }
    }

    const body = await req.json();
    const { action, email, role } = body;

    if (action === "list") {
      const { data, error } = await admin.from("admin_roles").select("*").order("created_at", { ascending: true });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (action === "add") {
      if (!email || !role) return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      if (role === "super_admin") return new Response(JSON.stringify({ error: "CANNOT_ADD_SUPER_ADMIN" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
      const { error } = await admin.from("admin_roles").upsert({ email: email.trim().toLowerCase(), role, added_by: user.email }, { onConflict: "email" });
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (action === "remove") {
      if (!email) return new Response(JSON.stringify({ error: "MISSING_EMAIL" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      if (email === SUPER_ADMIN) return new Response(JSON.stringify({ error: "CANNOT_REMOVE_SUPER_ADMIN" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
      const { error } = await admin.from("admin_roles").delete().eq("email", email);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (action === "update_role") {
      if (!email || !role) return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      if (email === SUPER_ADMIN) return new Response(JSON.stringify({ error: "CANNOT_MODIFY_SUPER_ADMIN" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
      if (role === "super_admin") return new Response(JSON.stringify({ error: "CANNOT_SET_SUPER_ADMIN" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
      const { error } = await admin.from("admin_roles").update({ role }).eq("email", email);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "UNKNOWN_ACTION" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("admin-manage-users error:", e);
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR", message: String(e) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
