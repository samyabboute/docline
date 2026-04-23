// Docline Configuration — modifier ce fichier pour changer les paramètres du projet
var DOCLINE_CONFIG = {
  SUPA_URL: 'https://ferkzwzypmdtuypxribz.supabase.co',
  SUPA_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlcmt6d3p5cG1kdHV5cHhyaWJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NjY4MjksImV4cCI6MjA4OTI0MjgyOX0.KbRa1t0VqrdURT0xbWLUXOZrf462wLNZaUgljk7h6eg',
  APP_URL:  'https://samyabboute.github.io/docline',
  // Emails avec accès admin — redirigés vers admin.html après connexion
  ADMIN_EMAILS: [
    'samyabboute5@gmail.com',
  ],
  get EDGE_BASE() { return this.SUPA_URL + '/functions/v1'; }
};
var SUPA_URL     = DOCLINE_CONFIG.SUPA_URL;
var SUPA_KEY     = DOCLINE_CONFIG.SUPA_KEY;
var ANON_KEY     = DOCLINE_CONFIG.SUPA_KEY;
var EDGE_BASE    = DOCLINE_CONFIG.EDGE_BASE;
var APP_URL      = DOCLINE_CONFIG.APP_URL;
var ADMIN_EMAILS = DOCLINE_CONFIG.ADMIN_EMAILS;

function getRedirectUrl(email) {
  return ADMIN_EMAILS.indexOf((email||'').toLowerCase()) !== -1 ? 'admin.html' : 'app.html';
}
