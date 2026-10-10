import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Moyen de paiement d'une demande → valeur acceptée par subscriptions.payment_method
const SUB_METHOD: Record<string, string> = { virement: "transfer", cash: "cash", cib: "online", edahabia: "online", baridimob: "online" };

// Trois cas :
//  - request_id : validation d'un paiement reçu (permission payments.decide) → abonnement payé,
//    demande approuvée, facture et paiement inscrits au registre par la base
//  - plan "free" : retour au gratuit (doctors.edit)
//  - sinon : accès offert sans paiement (doctors.edit), jamais marqué comme payé
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return json({ error: "UNAUTHORIZED" }, 401);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "UNAUTHORIZED" }, 401);

    const { target_user_id, plan, months = 1, is_trial = false, request_id = null } = await req.json();
    if (!target_user_id || !plan) return json({ error: "MISSING_FIELDS" }, 400);
    if (!["free", "pro", "clinic"].includes(plan)) return json({ error: "INVALID_PLAN" }, 400);

    const perm = request_id ? "payments.decide" : "doctors.edit";
    const { data: allowed } = await caller.rpc("symphony_can", { p_perm: perm });
    if (allowed !== true) return json({ error: "FORBIDDEN" }, 403);

    const now = new Date();
    const { data: current } = await admin.from("subscriptions").select("expires_at,plan").eq("user_id", target_user_id).maybeSingle();

    if (plan === "free") {
      const { error } = await admin.from("subscriptions").upsert({
        user_id: target_user_id, plan: "free", status: "active", payment_status: null, expires_at: null,
        trial_end_date: null, invoice_notes: null, updated_at: now.toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
      await admin.from("kyc_audit_log").insert({ doctor_id: target_user_id, action: "set_plan", reviewer_id: user.id, note: "free" });
      return json({ ok: true, mode: "free", expires_at: null });
    }

    let n = Math.round(Number(months));
    let request: Record<string, unknown> | null = null;
    if (request_id) {
      const { data: r } = await admin.from("payment_requests").select("*").eq("id", request_id).maybeSingle();
      if (!r || r.user_id !== target_user_id) return json({ error: "REQUEST_NOT_FOUND" }, 404);
      if (r.status !== "pending") return json({ error: "REQUEST_ALREADY_PROCESSED", message: "Cette demande a déjà été traitée." }, 409);
      request = r;
      n = r.billing === "yearly" ? 12 : 1;
    }
    if (!(n >= 1 && n <= 24)) return json({ error: "DURATION_INVALID" }, 400);

    // Un renouvellement prolonge l'abonnement en cours au lieu de l'écraser
    const start = current?.expires_at && new Date(current.expires_at as string) > now && current.plan === plan
      ? new Date(current.expires_at as string) : now;
    const end = new Date(start); end.setMonth(end.getMonth() + n);
    const interval = n >= 12 ? "year" : "month";

    if (request) {
      // La demande passe d'abord en « approuvée » : la base s'en sert pour le montant inscrit au registre
      const { error: rErr } = await admin.from("payment_requests")
        .update({ status: "approved", updated_at: now.toISOString() }).eq("id", request_id).eq("status", "pending");
      if (rErr) throw rErr;
      const { error } = await admin.from("subscriptions").upsert({
        user_id: target_user_id, plan, status: "active", interval, billing: n >= 12 ? "yearly" : "monthly",
        payment_status: "paid", paid_at: now.toISOString(), payment_method: SUB_METHOD[request.method as string] ?? null,
        invoice_notes: null, started_at: start.toISOString(), expires_at: end.toISOString(),
        current_period_start: start.toISOString(), current_period_end: end.toISOString(), updated_at: now.toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
      await admin.from("profiles").update({ is_active: true, plan, plan_interval: interval }).eq("id", target_user_id);
      await admin.from("kyc_audit_log").insert({ doctor_id: target_user_id, action: "approve_payment", reviewer_id: user.id,
        note: `${plan} ${n} mois · demande ${request_id}` });
      return json({ ok: true, mode: "payment", expires_at: end.toISOString() });
    }

    // Accès offert : jamais marqué comme payé
    const { error } = await admin.from("subscriptions").upsert({
      user_id: target_user_id, plan, status: "active", interval, payment_status: "complimentary", invoice_notes: "admin_grant",
      started_at: start.toISOString(), expires_at: end.toISOString(), trial_end_date: is_trial ? end.toISOString() : null,
      current_period_start: start.toISOString(), current_period_end: end.toISOString(), updated_at: now.toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw error;
    await admin.from("profiles").update({ trial_ends_at: end.toISOString(), trial_granted_months: n }).eq("id", target_user_id);
    await admin.from("kyc_audit_log").insert({ doctor_id: target_user_id, action: "set_plan", reviewer_id: user.id,
      note: `${plan} offert ${n} mois` });

    if (is_trial) {
      try {
        const { data: doc } = await admin.from("profiles").select("email,first_name").eq("id", target_user_id).maybeSingle();
        if (doc?.email) await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/send-email", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ type: "trial_granted", payload: { to: doc.email, first_name: doc.first_name ?? "Docteur" } }),
        });
      } catch (_) { /* envoi non bloquant */ }
    }
    return json({ ok: true, mode: "grant", expires_at: end.toISOString() });
  } catch (e) {
    console.error("activate-plan error:", e);
    return json({ error: "INTERNAL_ERROR", message: String(e) }, 500);
  }
});
