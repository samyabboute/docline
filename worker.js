const ROUTES = {
  '/':                  '/find-doctor.html',
  '/find-doctor':       '/find-doctor.html',
  '/login':             '/login.html',
  '/dashboard':         '/app.html',
  '/admin':             '/admin.html',
  '/admin-users':       '/admin-users.html',
  '/admin-featured':    '/admin-featured.html',
  '/admin-revenue':     '/admin-revenue.html',
  '/admin-security':    '/admin-security.html',
  '/admin-settings':    '/admin-settings.html',
  '/admin-emails':      '/admin-emails.html',
  '/admin-analytics':   '/admin-analytics.html',
  '/admin-crm':         '/admin-crm.html',
  '/admin-simulate':    '/admin-simulate.html',
  '/admin-ads':         '/admin-ads.html',
  '/pricing':           '/pricing.html',
  '/patients':          '/patients.html',
  '/calendar':          '/calendar.html',
  '/book':              '/book.html',
  '/mes-rdv':           '/mes-rdv.html',
  '/privacy':           '/privacy.html',
  '/terms':             '/terms.html',
  '/onboarding':        '/onboarding.html',
  '/import':            '/import.html',
  '/consultations':     '/consultations.html',
  '/disponibilites':    '/disponibilites.html',
  '/ordonnances':       '/ordonnances.html',
  '/labo':              '/labo.html',
  '/staff':             '/staff.html',
  '/clinic-agenda':     '/clinic-agenda.html',
  '/profil-public':     '/profil-public.html',
  '/queue':             '/queue.html',
  '/queue-display':     '/queue-display.html',
  '/queue-join':        '/queue-join.html',
  '/confirm':           '/confirm.html',
  '/ticket':            '/ticket.html',
  '/results-view':      '/results-view.html',
  '/patient':           '/patient.html',
  '/mon-espace':        '/patient.html',
  '/payment-return':    '/payment-return.html',
  '/landing':           '/landing.html',
  '/rejoindre':         '/rejoindre.html',
  '/etablissement':     '/etablissement.html',
  '/ecran':             '/ecran.html',
};

const SUPA_URL = 'https://ferkzwzypmdtuypxribz.supabase.co';
// Clé publique (anon), la même que dans config.js : elle n'ouvre que les fonctions publiques.
const SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlcmt6d3p5cG1kdHV5cHhyaWJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NjY4MjksImV4cCI6MjA4OTI0MjgyOX0.KbRa1t0VqrdURT0xbWLUXOZrf462wLNZaUgljk7h6eg';

async function clinicPage(request, env, path) {
  const page = await env.ASSETS.fetch(new URL('/clinique.html', request.url).href);
  const slug = decodeURIComponent(path.split('/')[2] || '').toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return page;
  let c = null;
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/rpc/clinic_public', {
      method: 'POST',
      headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug }),
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    c = r.ok ? await r.json() : null;
  } catch (e) { c = null; }
  if (!c || !c.name) return page;
  const place = [c.city, c.wilaya].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  const docs = (c.doctors || []).length;
  const services = (c.services || []).map((x) => x.name);
  const title = c.name + (place ? ' · ' + place : '') + ' · Rendez-vous en ligne · Docline';
  const desc = (c.description ? String(c.description).replace(/\s+/g, ' ').slice(0, 150) + ' ' : '')
    + docs + ' médecin' + (docs > 1 ? 's' : '') + (services.length ? ' : ' + services.slice(0, 4).join(', ') : '')
    + '. Horaires, attente en direct et rendez-vous en ligne.';
  const url = 'https://docline.health/clinique/' + c.slug;
  const ld = {
    '@context': 'https://schema.org', '@type': 'MedicalClinic', name: c.name, url, telephone: c.phone || undefined,
    address: { '@type': 'PostalAddress', streetAddress: c.address || undefined, addressLocality: c.city || undefined, addressRegion: c.wilaya || undefined, addressCountry: 'DZ' },
    medicalSpecialty: services,
    openingHoursSpecification: (c.hours || []).map((h) => ({ '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][h.dow], opens: h.from, closes: h.to })),
  };
  const ldText = JSON.stringify(ld).replace(/</g, '\\u003c');
  const set = (attr, val) => ({ element(e) { e.setAttribute(attr, val); } });
  const res = new HTMLRewriter()
    .on('title#meta-title', { element(e) { e.setInnerContent(title); } })
    .on('meta#meta-desc', set('content', desc))
    .on('meta#og-title', set('content', c.name + ' · Docline'))
    .on('meta#og-desc', set('content', desc))
    .on('meta#og-url', set('content', url))
    .on('link#canonical', set('href', url))
    .on('head', { element(e) { e.append('<script type="application/ld+json" id="ld-clinic">' + ldText + '</script>', { html: true }); } })
    .transform(page);
  const h = new Headers(res.headers);
  h.set('Cache-Control', 'public, max-age=120');
  return new Response(res.body, { status: 200, headers: h });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // /clinique/:slug → clinique.html, avec titre, description et aperçu de partage générés côté serveur
    if (path.startsWith('/clinique/') && path.length > 10) {
      return clinicPage(request, env, path);
    }

    // /dr/:slug → dr.html
    if (path.startsWith('/dr/') && path.length > 4) {
      return env.ASSETS.fetch(new URL('/dr.html', request.url).href);
    }

    // Localisation approximative du visiteur (déduite de l'IP par Cloudflare), rien n'est stocké
    if (path === '/api/geo') {
      const cf = request.cf || {};
      return Response.json(
        { country: cf.country || null, region: cf.region || null, city: cf.city || null },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    // /sitemap.xml → Supabase
    if (path === '/sitemap.xml') {
      return fetch('https://ferkzwzypmdtuypxribz.supabase.co/functions/v1/sitemap');
    }

    // Clean URL → .html
    if (ROUTES[path]) {
      return env.ASSETS.fetch(new URL(ROUTES[path], request.url).href);
    }

    // Fichier statique direct (.html, .js, .css, images…)
    return env.ASSETS.fetch(request.url);
  },
};
