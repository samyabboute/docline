// ============================================================
// DOCLINE — chargily-checkout Edge Function
// Crée une session de paiement Chargily Pay (CIB / EDAHABIA)
// Secrets requis : CHARGILY_API_KEY, APP_URL
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHARGILY_API = "https://pay.chargily.net/api/v2";

const AMOUNTS: Record<string, Record<string, number>> = {
  pro:        { monthly: 5900,  yearly: 59000 },
  enterprise: { monthly: 13900, yearly: 139000 },
};

const PLAN_LABELS: Record<string, string> = {
  pro:        "Pro Médecin",
  enterprise: "Pro Clinique",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Auth ─────────────────────────────────────────────────
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // ── Params ───────────────────────────────────────────────
  const { plan, billing, method } = await req.json() as {
    plan: string;
    billing: "monthly" | "yearly";
    method: "cib" | "edahabia";
  };

  const amount = AMOUNTS[plan]?.[billing];
  if (!amount) {
    return new Response(JSON.stringify({ error: "Plan ou facturation invalide" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // ── URLs de retour ───────────────────────────────────────
  const appUrl = (Deno.env.get("APP_URL") ?? "https://samyabboute.github.io/docline").replace(/\/$/, "");
  const successUrl = `${appUrl}/payment-return?status=success&plan=${plan}&billing=${billing}`;
  const failureUrl = `${appUrl}/payment-return?status=error`;

  // ── Appel API Chargily ───────────────────────────────────
  const chargilyKey = Deno.env.get("CHARGILY_API_KEY");
  if (!chargilyKey) {
    return new Response(JSON.stringify({ error: "CHARGILY_API_KEY non configurée" }), {
      status: 503, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/chargily-webhook`;

  const chargilyBody = {
    amount,
    currency: "dzd",
    payment_method: method,          // "cib" ou "edahabia"
    success_url: successUrl,
    failure_url: failureUrl,
    webhook_endpoint: webhookUrl,
    description: `Docline ${PLAN_LABELS[plan]} · ${billing === "yearly" ? "Annuel" : "Mensuel"}`,
    metadata: {
      user_id:    user.id,
      user_email: user.email ?? "",
      plan,
      billing,
    },
  };

  const chargilyRes = await fetch(`${CHARGILY_API}/checkouts`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${chargilyKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(chargilyBody),
  });

  if (!chargilyRes.ok) {
    const errText = await chargilyRes.text();
    console.error("Chargily error:", chargilyRes.status, errText);
    return new Response(
      JSON.stringify({ error: "Erreur Chargily Pay", details: errText }),
      { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  const checkout = await chargilyRes.json() as { id: string; checkout_url: string };

  // ── Enregistrer la demande en base ───────────────────────
  const { error: dbError } = await supabase.from("payment_requests").insert({
    user_id:              user.id,
    user_email:           user.email,
    plan,
    billing,
    amount,
    method,
    status:               "pending",
    chargily_checkout_id: checkout.id,
    reference:            checkout.id,
    notes:                `Paiement en ligne Chargily Pay (${method.toUpperCase()})`,
  });

  if (dbError) {
    // Non-bloquant : on log mais on retourne quand même l'URL
    console.error("DB insert error:", dbError.message);
  }

  return new Response(
    JSON.stringify({ url: checkout.checkout_url, checkout_id: checkout.id }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
  );
});
