import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";
import { guardMessage, ipHashFrom, messagingConfig, normalizePhone, sendMessage } from "../_shared/messaging.ts";

const CORS = {
  "Access-Control-Allow-Origin": "https://docline.health",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Config ─────────────────────────────────────────────────────────────
const OTP_SECRET  = Deno.env.get("OTP_SECRET")           ?? "docline-otp-secret-change-me";

// ── Helpers ────────────────────────────────────────────────────────────

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateOTP(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
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

    // Limites (par numéro, par connexion, plafonds globaux, numéros bloqués, Algérie seulement) :
    // appliquées par le module d'envoi avant chaque SMS (_shared/messaging.ts).
    // Générer et stocker l'OTP (5 min)
    const otp      = generateOTP();
    const otpHash  = await sha256hex(otp + OTP_SECRET + phoneHash);
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();


    // Le code n'est jamais renvoyé au navigateur : sans fournisseur d'envoi, la vérification est impossible
    if (!messagingConfig().account) {
      return new Response(
        JSON.stringify({ error: "SMS_UNAVAILABLE", message: "L'envoi du code est momentanément indisponible. Réessayez plus tard ou appelez le cabinet." }),
        { status: 503, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // SMS envoyé par l'expéditeur « Docline »
    const r = await sendMessage(supabase, { to: phoneE164, kind: "otp", scope: "public", ipHash: await ipHashFrom(req),
      text: `Docline : votre code est ${otp}. Valable 5 minutes, ne le partagez avec personne.` });
    if (!r.sent) {
      const guarded = /^[A-Z_]+$/.test(r.error ?? "") && !/^\d/.test(r.error ?? "");
      return new Response(
        JSON.stringify({ error: guarded ? r.error : "SEND_FAILED", message: guarded ? guardMessage(r.error) : "Impossible d'envoyer le code. Vérifiez votre numéro ou réessayez dans un instant." }),
        { status: guarded ? 429 : 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }
    // Le code n'est enregistré qu'une fois le SMS parti : une demande refusée n'annule pas le code déjà reçu
    await supabase.from("otp_verifications").delete().eq("phone_hash", phoneHash);
    await supabase.from("otp_verifications").insert({ phone_hash: phoneHash, otp_hash: otpHash, expires_at: expiresAt });

    return new Response(
      JSON.stringify({ success: true, channel: r.channel, message: "Code envoyé par SMS" }),
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
