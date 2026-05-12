import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.3.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient(),
});

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });

  const { price_id, success_url, cancel_url } = await req.json();

  // Get or create Stripe customer
  const { data: sub } = await supabase.from("subscriptions").select("stripe_customer_id").eq("user_id", user.id).single();
  const { data: profile } = await supabase.from("profiles").select("email, first_name, last_name").eq("id", user.id).single();

  let customerId = sub?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile?.email ?? user.email,
      name: `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim(),
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await supabase.from("subscriptions").update({ stripe_customer_id: customerId }).eq("user_id", user.id);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    line_items: [{ price: price_id, quantity: 1 }],
    mode: "subscription",
    success_url: success_url ?? `${Deno.env.get("APP_URL")}/app.html?upgrade=success`,
    cancel_url: cancel_url ?? `${Deno.env.get("APP_URL")}/pricing.html`,
    subscription_data: { metadata: { supabase_user_id: user.id } },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    tax_id_collection: { enabled: true }, // EU VAT
  });

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200, headers: { ...CORS, "Content-Type": "application/json" },
  });
});
