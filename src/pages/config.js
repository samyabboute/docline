// Docline Configuration — modifier ce fichier pour changer les paramètres du projet
var DOCLINE_CONFIG = {
  SUPA_URL: 'https://ferkzwzypmdtuypxribz.supabase.co',
  SUPA_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlcmt6d3p5cG1kdHV5cHhyaWJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NjY4MjksImV4cCI6MjA4OTI0MjgyOX0.KbRa1t0VqrdURT0xbWLUXOZrf462wLNZaUgljk7h6eg',
  APP_URL:  'https://docline.health',
  // Emails avec accès admin — redirigés vers /admin après connexion
  ADMIN_EMAILS: [
    'samyabboute5@gmail.com',
    'contact@docline.health',
  ],
  get EDGE_BASE() { return this.SUPA_URL + '/functions/v1'; }
};
var SUPA_URL     = DOCLINE_CONFIG.SUPA_URL;
var SUPA_KEY     = DOCLINE_CONFIG.SUPA_KEY;
var ANON_KEY     = DOCLINE_CONFIG.SUPA_KEY;
var EDGE_BASE    = DOCLINE_CONFIG.EDGE_BASE;
var APP_URL      = DOCLINE_CONFIG.APP_URL;
var ADMIN_EMAILS = DOCLINE_CONFIG.ADMIN_EMAILS;

// ── GitHub Pages base path (site sous /docline/ sur GHP, / sur Netlify) ──
var _GHP_BASE = (function() {
  try { return window.location.pathname.startsWith('/docline') ? '/docline' : ''; }
  catch(e) { return ''; }
})();

// Convertit un chemin absolu propre vers son équivalent GHP (/login → /docline/login.html)
// Sur Netlify (_GHP_BASE='') retourne le chemin inchangé.
function ghpNav(path) {
  if (!_GHP_BASE) return path;
  var MAP = {
    '/login':'/login.html', '/dashboard':'/app.html', '/app':'/app.html',
    // Symphony (admin platform) — new canonical routes
    '/symphony':'/symphony.html', '/symphony-crm':'/symphony-crm.html',
    '/symphony-simulate':'/symphony-simulate.html', '/symphony-users':'/symphony-users.html',
    '/symphony-featured':'/symphony-featured.html', '/symphony-emails':'/symphony-emails.html',
    '/symphony-revenue':'/symphony-revenue.html', '/symphony-security':'/symphony-security.html',
    '/symphony-settings':'/symphony-settings.html', '/symphony-analytics':'/symphony-analytics.html',
    '/symphony-ads':'/symphony-ads.html', '/symphony-agents':'/symphony-agents.html',
    '/symphony-kyc':'/symphony-kyc.html', '/symphony-incidents':'/symphony-incidents.html',
    // Legacy admin routes — redirect to symphony equivalents
    '/admin':'/symphony.html', '/admin-crm':'/symphony-crm.html', '/admin-simulate':'/symphony-simulate.html', '/admin-users':'/symphony-users.html',
    '/admin-featured':'/symphony-featured.html', '/admin-emails':'/symphony-emails.html',
    '/admin-revenue':'/symphony-revenue.html', '/admin-security':'/symphony-security.html',
    '/admin-settings':'/symphony-settings.html', '/admin-analytics':'/symphony-analytics.html',
    '/admin-ads':'/symphony-ads.html',
    '/maintenance':'/maintenance.html',
    '/pricing':'/pricing.html',
    '/patients':'/patients.html', '/clients':'/clients.html',
    '/calendar':'/calendar.html', '/mes-rdv':'/mes-rdv.html',
    '/book':'/book.html', '/find-doctor':'/find-doctor.html',
    '/consultations':'/consultations.html', '/ordonnances':'/ordonnances.html',
    '/queue':'/queue.html', '/labo':'/labo.html', '/staff':'/staff.html',
    '/onboarding':'/onboarding.html', '/timer':'/timer.html',
    '/paiement':'/paiement.html', '/privacy':'/privacy.html', '/terms':'/terms.html',
    '/invoices':'/invoices.html', '/proposals':'/proposals.html',
  };
  var base = path.split('?')[0];
  var qs   = path.includes('?') ? path.slice(path.indexOf('?')) : '';
  return _GHP_BASE + (MAP[base] || base + '.html') + qs;
}

function getRedirectUrl(email) {
  // Super-admins → Symphony hub
  var path = ADMIN_EMAILS.indexOf((email||'').toLowerCase()) !== -1 ? '/symphony-users' : '/dashboard';
  return ghpNav(path);
}

// ── MAINTENANCE GUARD ─────────────────────────────────────────────────────────
// Maintenance ON :
//   • Pages publiques (/find-doctor, /book, /pricing…) → bloquées pour TOUS
//   • Pages doctor app (/dashboard, /calendar, /patients…) → accessibles aux
//     médecins connectés (refresh_token présent), bloquées pour les anonymes
//   • Symphony (/symphony*) → toujours accessible (admin)
//   • /login, /maintenance → toujours accessibles
// Fail-open : erreur réseau → page affichée.
(function _maintGuard() {
  try {
    var p = window.location.pathname;

    // ── Toujours accessibles (jamais bloquées) ───────────────────────────────
    var alwaysOk = ['maintenance', 'symphony', 'login'];
    for (var i = 0; i < alwaysOk.length; i++) {
      if (p.indexOf(alwaysOk[i]) >= 0) return;
    }

    // ── Pages espace médecin (accessibles aux connectés pendant maintenance) ──
    var doctorPages = [
      '/dashboard', '/app', '/calendar', '/mes-rdv',
      '/patients', '/clients', '/consultations', '/ordonnances',
      '/queue', '/labo', '/staff', '/onboarding',
      '/timer', '/paiement', '/invoices', '/proposals'
    ];
    function _isDoctorPage() {
      for (var j = 0; j < doctorPages.length; j++) {
        if (p.indexOf(doctorPages[j]) >= 0) return true;
      }
      return false;
    }

    // ── Session connectée (refresh_token = médecin ou admin) ─────────────────
    function _hasSession() {
      try {
        var raw = localStorage.getItem('sb-ferkzwzypmdtuypxribz-auth-token');
        if (!raw) return false;
        var s = JSON.parse(raw);
        return !!(s && s.refresh_token);
      } catch(e) { return false; }
    }

    // ── Cacher la page avant tout rendu ──────────────────────────────────────
    var html = document.documentElement;
    html.style.opacity    = '0';
    html.style.visibility = 'hidden';
    html.style.transition = 'none';

    function _show() {
      html.style.opacity    = '1';
      html.style.visibility = 'visible';
    }
    function _redirect() {
      var dest = '/maintenance';
      if (typeof ghpNav === 'function') dest = ghpNav(dest);
      window.location.replace(dest);
    }

    // ── Vérifier maintenance_mode ─────────────────────────────────────────────
    fetch(SUPA_URL + '/rest/v1/app_settings?key=eq.maintenance_mode&select=value', {
      headers: { 'apikey': SUPA_KEY, 'Cache-Control': 'no-cache, no-store' }
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(rows) {
      if (!rows || !rows.length) { _show(); return; }
      var val  = rows[0].value;
      var isOn = (val === true)
              || (val === 'true')
              || (typeof val === 'string' && val.replace(/"/g, '') === 'true');

      if (!isOn) { _show(); return; } // Maintenance OFF → tout le monde passe

      // Maintenance ON :
      // Page doctor app + médecin connecté → laisser passer
      if (_isDoctorPage() && _hasSession()) { _show(); return; }

      // Tout le reste (pages publiques, anonymes sur pages doctor) → maintenance
      _redirect();
    })
    .catch(function() { _show(); }); // Erreur réseau → fail open

  } catch(e) {
    try { document.documentElement.style.opacity='1'; document.documentElement.style.visibility='visible'; } catch(_){}
  }
})();
