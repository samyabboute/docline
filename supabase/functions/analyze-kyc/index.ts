import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_KEY  = Deno.env.get("GEMINI_API_KEY") ?? "";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL")    ?? "samyabboute5@gmail.com";
const GEMINI_URL  = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401, headers: CORS });

  try {
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });

    // Allow super_admin or any admin_roles entry
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (user.email !== ADMIN_EMAIL) {
      const { data: roleRow } = await admin.from("admin_roles").select("role").eq("email", user.email).single();
      if (!roleRow) return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const { doctorId } = await req.json();
    if (!doctorId) return new Response(JSON.stringify({ error: "MISSING_DOCTOR_ID" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

    // Charger le profil médecin (admin client already created above)
    const { data: profile } = await admin.from("profiles")
      .select("full_name, first_name, last_name, kyc_document_url, kyc_document_type, kyc_order_number")
      .eq("id", doctorId).single();

    if (!profile?.kyc_document_url) {
      return new Response(JSON.stringify({ error: "NO_DOCUMENT" }), { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Télécharger le document depuis Supabase Storage
    const { data: fileData, error: fileErr } = await admin.storage
      .from("doctor-kyc")
      .download(profile.kyc_document_url.replace(/.*doctor-kyc\//, ""));

    if (fileErr || !fileData) {
      return new Response(JSON.stringify({ error: "FILE_NOT_FOUND", detail: fileErr?.message }), { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Convertir en base64
    const buffer = await fileData.arrayBuffer();
    const bytes  = new Uint8Array(buffer);
    let binary   = "";
    bytes.forEach(b => binary += String.fromCharCode(b));
    const base64 = btoa(binary);
    const mime   = fileData.type || "image/jpeg";

    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ error: "NO_GEMINI_KEY", message: "Configurez GEMINI_API_KEY dans les secrets Supabase." }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Appel Gemini
    const doctorName = profile.full_name || `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim();
    const prompt = `Tu es un expert en vérification de documents médicaux officiels en Algérie.

Le médecin qui soumet ce document s'appelle : "${doctorName}"
Type de document déclaré : "${profile.kyc_document_type}"
Numéro d'ordre déclaré : "${profile.kyc_order_number ?? 'non fourni'}"

DOCUMENTS RECONNUS EN ALGÉRIE :
- Carte de membre de l'Ordre des Médecins (Conseil de l'Ordre National des Médecins - ONAM)
- Diplôme de Docteur en Médecine (Université algérienne)
- Diplôme de spécialiste (DES, DESC)
- Attestation d'inscription à l'Ordre des Médecins de wilaya
- Carte professionnelle de médecin délivrée par le Ministère de la Santé
- Relevé de notes final (valable pour les jeunes médecins)

INSTRUCTIONS D'ANALYSE :
1. Vérifie si le document est authentique et lisible
2. Extrait le nom exact figurant sur le document et compare avec "${doctorName}"
3. Vérifie la présence d'un cachet officiel, signature, numéro d'enregistrement
4. Le numéro d'ordre doit correspondre à celui déclaré (${profile.kyc_order_number ?? 'non fourni'})
5. Vérifie la date de validité si présente
6. Méfie-toi des documents flous, mal cadrés, ou manifestement falsifiés

Réponds UNIQUEMENT en JSON valide, sans texte avant ou après :
{
  "est_document_medical": true,
  "type_detecte": "Carte Ordre des Médecins | Diplôme | Attestation | Autre | Inconnu",
  "nom_sur_document": "nom exact lu sur le document",
  "concordance_nom": true,
  "numero_ordre": "numéro lu sur le document ou null",
  "concordance_numero": true,
  "specialite": "spécialité détectée ou null",
  "autorite_emettrice": "organisme émetteur",
  "date_emission": "date si visible ou null",
  "date_expiration": "date si visible ou null",
  "document_lisible": true,
  "cachet_present": true,
  "confiance": "high | medium | low",
  "alertes": ["liste de problèmes détectés si applicable"],
  "remarques": "observation générale courte",
  "recommandation": "approuver | rejeter | verifier_manuellement"
}`;

    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mime, data: base64 } }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
      })
    });

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Parser le JSON retourné par Gemini
    let analysis: Record<string, unknown> = { raw: rawText };
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
    } catch (_) { /* garder raw */ }

    // Sauvegarder le résultat dans kyc_audit_log (best-effort, ne bloque pas l'analyse)
    try {
      await admin.from("kyc_audit_log").insert({
        doctor_id:    doctorId,
        action:       "ai_analysis",
        document_url: profile.kyc_document_url,
        note:         JSON.stringify(analysis).slice(0, 1000),
      });
    } catch (_logErr) { /* ne pas bloquer si le log échoue */ }

    return new Response(JSON.stringify({ ok: true, analysis }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" }
    });

  } catch (e) {
    console.error("analyze-kyc error:", e);
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR", message: String(e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
});
