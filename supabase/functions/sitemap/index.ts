import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE = "https://docline.health";

const STATIC_PAGES = [
  { loc: "/find-doctor", priority: "1.0", changefreq: "daily" },
  { loc: "/pricing",     priority: "0.8", changefreq: "monthly" },
  { loc: "/privacy",     priority: "0.3", changefreq: "yearly" },
  { loc: "/terms",       priority: "0.3", changefreq: "yearly" },
];

serve(async () => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!
  );

  // Récupérer tous les médecins actifs avec un slug
  const { data: doctors } = await sb
    .from("profiles")
    .select("slug, specialty, wilaya, updated_at")
    .eq("is_active", true)
    .not("slug", "is", null)
    .order("updated_at", { ascending: false });

  const today = new Date().toISOString().slice(0, 10);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
`;

  // Pages statiques
  for (const page of STATIC_PAGES) {
    xml += `  <url>
    <loc>${SITE}${page.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>\n`;
  }

  // Pages médecins dynamiques
  for (const doc of (doctors ?? [])) {
    const lastmod = doc.updated_at
      ? new Date(doc.updated_at).toISOString().slice(0, 10)
      : today;
    xml += `  <url>
    <loc>${SITE}/dr/${doc.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>\n`;
  }

  xml += `</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
});
