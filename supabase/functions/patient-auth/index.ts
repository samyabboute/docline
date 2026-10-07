// patient-auth — passwordless patient sign-in / sign-up.
// Flow: page calls send-otp {phone}, then patient-auth {phone, otp, fullName?}.
// Returns an opaque session token (only its SHA-256 is stored) valid 90 days.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const OTP_SECRET = Deno.env.get("OTP_SECRET") ?? "docline-otp-secret-change-me";

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

function generateToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/[+/=]/g, c => c === "+" ? "-" : c === "/" ? "_" : "");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { phone, otp, fullName } = await req.json();
    const phoneE164 = normalizePhone(String(phone ?? ""));
    if (!phoneE164 || !otp) return json({ error: "MISSING_FIELDS", message: "Numéro et code requis." }, 400);

    const phoneHash = await sha256hex(phoneE164);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: rec } = await supabase
      .from("otp_verifications").select("*")
      .eq("phone_hash", phoneHash)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!rec) return json({ error: "OTP_EXPIRED", message: "Code expiré. Demandez un nouveau code." }, 400);
    if (rec.attempts >= 5) {
      await supabase.from("otp_verifications").delete().eq("id", rec.id);
      return json({ error: "OTP_MAX_ATTEMPTS", message: "Trop de tentatives. Demandez un nouveau code." }, 429);
    }
    if (await sha256hex(String(otp) + OTP_SECRET + phoneHash) !== rec.otp_hash) {
      await supabase.from("otp_verifications").update({ attempts: rec.attempts + 1 }).eq("id", rec.id);
      const remaining = 5 - rec.attempts - 1;
      return json({ error: "OTP_INVALID", message: `Code incorrect. ${remaining} tentative(s) restante(s).`, remaining }, 400);
    }
    await supabase.from("otp_verifications").delete().eq("id", rec.id);

    // Find or create the patient
    const name = typeof fullName === "string" ? fullName.trim().slice(0, 120) : "";
    const now = new Date().toISOString();
    const { data: existing } = await supabase.from("patients")
      .select("id, full_name, account_created_at").eq("phone_hash", phoneHash).maybeSingle();

    let patientId: string;
    let isNew = false;
    if (existing) {
      patientId = existing.id;
      const upd: Record<string, unknown> = { last_login_at: now };
      if (!existing.account_created_at) { upd.account_created_at = now; isNew = true; }
      if (name && !existing.full_name) upd.full_name = name;
      await supabase.from("patients").update(upd).eq("id", patientId);
    } else {
      const { data: np, error: pe } = await supabase.from("patients")
        .insert({ phone_hash: phoneHash, phone_e164: phoneE164, full_name: name || null,
                  account_created_at: now, last_login_at: now })
        .select("id").single();
      if (pe || !np) throw new Error("Patient creation failed: " + pe?.message);
      patientId = np.id;
      isNew = true;
    }

    const session = generateToken();
    const { error: se } = await supabase.from("patient_sessions").insert({
      patient_id: patientId,
      token_hash: await sha256hex(session),
      expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 200),
    });
    if (se) throw new Error("Session creation failed: " + se.message);

    return json({ success: true, session, isNew });
  } catch (e) {
    console.error("patient-auth error:", e);
    return json({ error: "INTERNAL_ERROR", message: "Erreur serveur. Réessayez." }, 500);
  }
});
