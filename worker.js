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
  '/payment-return':    '/payment-return.html',
  '/landing':           '/landing.html',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // /dr/:slug → dr.html
    if (path.startsWith('/dr/') && path.length > 4) {
      return env.ASSETS.fetch(new URL('/dr.html', request.url).href);
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
