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
    '/admin':'/admin.html', '/admin-crm':'/admin-crm.html', '/admin-simulate':'/admin-simulate.html', '/admin-users':'/admin-users.html',
    '/admin-featured':'/admin-featured.html', '/admin-emails':'/admin-emails.html',
    '/admin-revenue':'/admin-revenue.html', '/admin-security':'/admin-security.html',
    '/admin-settings':'/admin-settings.html', '/admin-analytics':'/admin-analytics.html',
    '/admin-ads':'/admin-ads.html',
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
  // Admins → nouveau panel admin-users (admin.html redirige aussi vers admin-users)
  var path = ADMIN_EMAILS.indexOf((email||'').toLowerCase()) !== -1 ? '/admin-users' : '/dashboard';
  return ghpNav(path);
}
