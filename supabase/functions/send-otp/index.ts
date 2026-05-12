import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Config ─────────────────────────────────────────────────────────────
const OTP_SECRET  = Deno.env.get("OTP_SECRET")           ?? "docline-otp-secret-change-me";
const TW_SID      = Deno.env.get("TWILIO_ACCOUNT_SID")  ?? "";
const TW_TOKEN    = Deno.env.get("TWILIO_AUTH_TOKEN")    ?? "";
const TW_WA_FROM  = Deno.env.get("TWILIO_WA_FROM")      ?? "";
const TW_FROM     = Deno.env.get("TWILIO_FROM_NUMBER")  ?? "";

// ── Helpers ────────────────────────────────────────────────────────────

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function normalizePhone(raw: string): string | null {
  const p = raw.replace(/[\s\-\.]/g, "");
  if (/^0[5-9]\d{8}$/.test(p))  return "+213" + p.slice(1);
  if (/^\+\d{7,15}$/.test(p))   return p;
  if (/^00\d{7,15}$/.test(p))   return "+" + p.slice(2);
  return null;
}

function generateOTP(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

// ── Twilio helper ──────────────────────────────────────────────────────
async function twilioSend(from: string, to: string, body: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
      }
    );
    const resp = await res.text();
    console.log(`[Twilio] ${res.status}: ${resp}`);
    return res.ok;
  } catch (e) {
    console.error("[Twilio] Exception:", e);
    return false;
  }
}

// ── Main ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { phone } = await req.json();

    const phoneE164 = normalizePhone(phone ?? "");
    if (!phoneE164) {
      return new Response(
        JSON.stringify({ error: "INVALID_PHONE", message: "Numéro invalide. Exemple : 0555 123 456" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const phoneHash = await sha256hex(phoneE164);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Rate limit : 3 OTP max par numéro par heure
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await supabase
      .from("otp_verifications")
      .select("*", { count: "exact", head: true })
      .eq("phone_hash", phoneHash)
      .gte("created_at", oneHourAgo);

    if ((count ?? 0) >= 3) {
      return new Response(
        JSON.stringify({ error: "RATE_LIMIT", message: "Trop de demandes. Réessayez dans 1 heure." }),
        { status: 429, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Générer et stocker l'OTP (5 min)
    const otp      = generateOTP();
    const otpHash  = await sha256hex(otp + OTP_SECRET + phoneHash);
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

    await supabase.from("otp_verifications").delete().eq("phone_hash", phoneHash);
    await supabase.from("otp_verifications").insert({ phone_hash: phoneHash, otp_hash: otpHash, expires_at: expiresAt });

    // Mode dev
    if (!TW_SID || Deno.env.get("DEV_SHOW_OTP") === "true") {
      console.log(`[DEV] OTP pour ${phoneE164}: ${otp}`);
      return new Response(
        JSON.stringify({ success: true, channel: "dev", otp, message: `[TEST] Votre code : ${otp}` }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // WhatsApp en priorité, SMS en fallback
    let sent = false;
    let channel = "sms";

    if (TW_WA_FROM) {
      const waText = `🔐 *Docline* — Votre code de vérification : *${otp}*\n\nValable 5 minutes. Ne le partagez pas.`;
      sent = await twilioSend("whatsapp:" + TW_WA_FROM.replace("whatsapp:", ""), "whatsapp:" + phoneE164, waText);
      if (sent) channel = "whatsapp";
    }

    if (!sent && TW_FROM) {
      const text = `Docline - Votre code : ${otp}\nValable 5 minutes. Ne le partagez pas.`;
      sent = await twilioSend(TW_FROM, phoneE164, text);
      if (sent) channel = "sms";
    }

    if (!sent) {
      return new Response(
        JSON.stringify({ error: "SEND_FAILED", message: "Impossible d'envoyer le code. Vérifiez votre numéro." }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const label = channel === "whatsapp" ? "WhatsApp" : "SMS";
    return new Response(
      JSON.stringify({ success: true, channel, message: `Code envoyé sur ${label}` }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("send-otp error:", e);
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
