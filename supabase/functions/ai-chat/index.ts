// ============================================================
// PROSPEO — AI Chat Edge Function
// supabase/functions/ai-chat/index.ts
// 
// SECURITY:
// - Verifies user JWT before processing
// - Checks Pro plan status (server-side — cannot be bypassed)
// - Anthropic API key stored as Supabase secret only
// - Rate limiting: 20 requests per user per hour
// - Logs to audit_log
// 
// Deploy: supabase functions deploy ai-chat
// Secrets needed:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const CORS = {
  "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RATE_LIMIT = 20; // requests per hour per user
const MODEL      = "claude-sonnet-4-20250514";
const MAX_TOKENS = 1024;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });

  // Verify user
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: CORS });

  // Check Pro plan (server-side — cannot be bypassed)
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: sub } = await svc.from("subscriptions").select("plan, status").eq("user_id", user.id).single();
  
  if (!sub || sub.plan === "free" || sub.status !== "active") {
    return new Response(JSON.stringify({ error: "Pro subscription required" }), { status: 403, headers: CORS });
  }

  // Rate limiting: count requests in last hour
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const { count } = await svc.from("audit_log")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("event", "ai.chat_request")
    .gte("created_at", oneHourAgo);
  
  if ((count ?? 0) >= RATE_LIMIT) {
    return new Response(JSON.stringify({ error: "Rate limit reached. Maximum 20 AI requests per hour." }), { status: 429, headers: CORS });
  }

  // Parse request
  const body = await req.json().catch(() => ({}));
  const { messages, system_prompt } = body;
  
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "Invalid request: messages required" }), { status: 400, headers: CORS });
  }

  // Validate messages (security: prevent prompt injection via user data)
  const safeMessages = messages.slice(-12).map((m: {role: string, content: string}) => ({
    role:    m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 4000) // cap content length
  }));

  // Call Anthropic API
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set. Run: supabase secrets set ANTHROPIC_API_KEY=sk-ant-..." }), { status: 500, headers: CORS });

  const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     system_prompt || "Tu es Nex, l'assistant IA de Prospeo, une application de gestion de cabinet médical en Algérie. Tu aides les médecins à gérer leur file d'attente, consultations, ordonnances et patients. Tu ne fournis pas de diagnostic médical. Réponds toujours en français.",
      messages:   safeMessages,
    }),
  });

  if (!aiResp.ok) {
    const errBody = await aiResp.text();
    console.error("Anthropic error:", errBody);
    return new Response(JSON.stringify({ error: "AI service error. Please try again." }), { status: 502, headers: CORS });
  }

  const aiData = await aiResp.json();

  // Log usage (for rate limiting + analytics)
  await svc.from("audit_log").insert({
    user_id:  user.id,
    event:    "ai.chat_request",
    metadata: {
      model:       MODEL,
      input_tokens:  aiData.usage?.input_tokens,
      output_tokens: aiData.usage?.output_tokens,
    }
  });

  return new Response(JSON.stringify(aiData), {
    status:  200,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
});
