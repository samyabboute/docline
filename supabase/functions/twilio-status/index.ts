// twilio-status : accusés de remise des SMS envoyés par Docline.
// Twilio appelle cette adresse à chaque changement de statut (envoyé, remis, échec).
// La requête est authentifiée par la signature X-Twilio-Signature (HMAC-SHA1 du jeton du compte).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const URL_SELF = `${Deno.env.get("SUPABASE_URL")}/functions/v1/twilio-status`;

async function validSignature(sig: string, params: URLSearchParams): Promise<boolean> {
  if (!TOKEN || !sig) return false;
  const keys = Array.from(new Set(Array.from(params.keys()))).sort();
  let data = URL_SELF;
  for (const k of keys) for (const v of params.getAll(k)) data += k + v;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  const expected = btoa(String.fromCharCode(...mac));
  return expected === sig;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const params = new URLSearchParams(await req.text());
  if (!(await validSignature(req.headers.get("X-Twilio-Signature") ?? "", params))) return new Response("forbidden", { status: 403 });

  const sid = params.get("MessageSid") ?? params.get("SmsSid");
  const status = params.get("MessageStatus") ?? params.get("SmsStatus");
  if (!sid || !status) return new Response("ok");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const upd: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (params.get("ErrorCode")) upd.error_code = params.get("ErrorCode");
  if (params.get("ErrorMessage")) upd.error_message = String(params.get("ErrorMessage")).slice(0, 300);
  if (params.get("Price")) { upd.price = Number(params.get("Price")); upd.price_unit = params.get("PriceUnit"); }
  await admin.from("message_logs").update(upd).eq("provider_sid", sid);
  return new Response("ok");
});
