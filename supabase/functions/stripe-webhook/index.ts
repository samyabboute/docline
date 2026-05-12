// ============================================================
// PROSPEO — Stripe Webhook Handler
// Supabase Edge Function: supabase/functions/stripe-webhook/index.ts
// Deploy: supabase functions deploy stripe-webhook
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.3.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

// Service role key — ONLY used server-side in Edge Functions
// This bypasses RLS for legitimate server writes
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const PRICE_TO_PLAN: Record<string, string> = {
  [Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") ?? ""]:  "pro",
  [Deno.env.get("STRIPE_PRICE_PRO_YEARLY") ?? ""]:   "pro",
  [Deno.env.get("STRIPE_PRICE_TEAM_MONTHLY") ?? ""]: "team",
  [Deno.env.get("STRIPE_PRICE_TEAM_YEARLY") ?? ""]:  "team",
};

async function syncSubscription(sub: Stripe.Subscription, eventType: string) {
  const priceId = sub.items.data[0]?.price?.id ?? "";
  const plan    = PRICE_TO_PLAN[priceId] ?? "free";
  const userId  = sub.metadata?.supabase_user_id;

  if (!userId) {
    console.error("[webhook] No supabase_user_id in metadata for sub:", sub.id);
    return;
  }

  await supabase.from("subscriptions").upsert({
    user_id:                userId,
    plan,
    status:                 sub.status,
    stripe_customer_id:     sub.customer as string,
    stripe_subscription_id: sub.id,
    stripe_price_id:        priceId,
    current_period_start:   new Date(sub.current_period_start * 1000).toISOString(),
    current_period_end:     new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end:   sub.cancel_at_period_end,
    trial_end:              sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
  }, { onConflict: "user_id" });

  await supabase.from("audit_log").insert({
    user_id:  userId,
    event:    `stripe.subscription.${eventType}`,
    metadata: { plan, stripe_subscription_id: sub.id },
  });
}

serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const sig  = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`Signature error: ${err.message}`, { status: 400 });
  }

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await syncSubscription(event.data.object as Stripe.Subscription, event.type);
      break;
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const uid = sub.metadata?.supabase_user_id;
      if (uid) {
        await supabase.from("subscriptions")
          .update({ plan: "free", status: "canceled" }).eq("user_id", uid);
        await supabase.from("audit_log").insert({
          user_id: uid,
          event: "stripe.subscription.deleted",
          metadata: { stripe_subscription_id: sub.id },
        });
      }
      break;
    }
    case "invoice.payment_failed":
    case "invoice.payment_succeeded": {
      const inv = event.data.object as Stripe.Invoice;
      if (inv.subscription) {
        const s = await stripe.subscriptions.retrieve(inv.subscription as string);
        await syncSubscription(s, event.type);
      }
      break;
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" }, status: 200,
  });
});
