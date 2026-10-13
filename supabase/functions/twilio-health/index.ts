// twilio-health : état de l'envoi des SMS et WhatsApp, pour l'équipe Docline (Symphony).
//  GET  : compte Twilio (essai ou complet, actif ou suspendu), solde, canaux configurés.
//  POST { to } : envoi d'un message de test vers ce numéro.
// Réservé aux membres de l'équipe ayant la permission « settings.manage ».
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { messagingConfig, sendMessage } from "../_shared/messaging.ts";

const CORS = {
  "Access-Control-Allow-Origin": "https://docline.health",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";

async function twilioGet(path: string) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}${path}`, { headers: { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`) } });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const auth = req.headers.get("Authorization") ?? "";
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: allowed } = await asUser.rpc("symphony_can", { p_perm: "settings.manage" });
  if (!allowed) return json({ error: "FORBIDDEN" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const r = await sendMessage(admin, { to: String(body.to ?? ""), kind: "test",
      text: "Docline : message de test. Si vous le recevez, l'envoi de SMS vers ce numéro fonctionne." });
    return json(r, r.sent ? 200 : 400);
  }

  const out: Record<string, unknown> = { config: messagingConfig() };
  if (SID && TOKEN) {
    const acc = await twilioGet(".json");
    out.account = acc.ok ? { type: acc.json.type, status: acc.json.status, name: acc.json.friendly_name } : { error: acc.status };
    const bal = await twilioGet("/Balance.json");
    if (bal.ok) out.balance = { amount: bal.json.balance, currency: bal.json.currency };
  }
  return json(out);
});
