// ============================================================
// DOCLINE — chargily-webhook Edge Function
// Reçoit les webhooks Chargily Pay et active l'abonnement
// Secrets requis : CHARGILY_SECRET (webhook secret), SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";

// ── Vérifie la signature HMAC-SHA256 ────────────────────────
async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return expected === signature;
  } catch {
    return false;
  }
}

// ── Calcule la date d'expiration ─────────────────────────────
function calcExpiry(billing: string): string {
  const d = new Date();
  if (billing === "yearly") {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString();
}

serve(async (req) => {
  // Chargily envoie un POST avec la signature dans le header 'signature'
  const signature = req.headers.get("signature") ?? "";
  const body = await req.text();

  // ── Vérification de la signature ─────────────────────────
  const secret = Deno.env.get("CHARGILY_SECRET");
  if (!secret) {
    console.error("CHARGILY_SECRET non configuré");
    return new Response("Configuration error", { status: 500 });
  }

  const valid = await verifySignature(body, signature, secret);
  if (!valid) {
    console.error("Signature invalide:", signature);
    return new Response("Invalid signature", { status: 401 });
  }

  // ── Parse l'événement ────────────────────────────────────
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Chargily envoie type = "checkout.paid" quand le paiement réussit
  if (event.type !== "checkout.paid") {
    // Autre événement (checkout.failed, etc.) — on répond OK sans agir
    return new Response("ok");
  }

  const checkout = event.data as Record<string, unknown>;
  const metadata = (checkout.metadata ?? {}) as Record<string, string>;

  const { user_id, user_email, plan, billing } = metadata;
  const checkoutId = checkout.id as string;

  if (!user_id || !plan || !billing) {
    console.error("Metadata manquante dans webhook:", metadata);
    return new Response("Missing metadata", { status: 400 });
  }

  // ── Client Supabase avec service_role (accès complet) ────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date().toISOString();
  const expiresAt = calcExpiry(billing);

  // ── 1. Activer / mettre à jour l'abonnement ──────────────
  const { error: subError } = await supabase
    .from("subscriptions")
    .upsert(
      {
        user_id,
        plan,
        status:       "active",
        billing,
        started_at:   now,
        expires_at:   expiresAt,
        activated_by: "webhook:chargily",
        updated_at:   now,
      },
      { onConflict: "user_id" }
    );

  if (subError) {
    console.error("Erreur activation abonnement:", subError.message);
    // On retourne 200 quand même pour éviter les re-tentatives Chargily
  } else {
    console.log(`Abonnement ${plan}/${billing} activé pour ${user_id} jusqu'au ${expiresAt}`);
  }

  // ── 2. Marquer le payment_request comme confirmé ─────────
  if (checkoutId) {
    const { error: prError } = await supabase
      .from("payment_requests")
      .update({ status: "confirmed", updated_at: now })
      .eq("chargily_checkout_id", checkoutId);

    if (prError) {
      console.error("Erreur mise à jour payment_request:", prError.message);
    }
  }

  return new Response("ok", { status: 200 });
});
