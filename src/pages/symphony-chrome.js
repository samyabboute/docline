/* Symphony : menu latéral commun à toutes les pages internes.
   Une seule liste de liens, le même rendu partout (référence : le QG).
   Les liens que le poste ne permet pas d'ouvrir sont masqués (permissions lues par symphony-access.js). */
(function () {
  'use strict';

  var ICON = {
    hq: '<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    tasks: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="m8 12 2.5 2.5L16 9"/>',
    team: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    demand: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    ticket: '<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z"/><path d="M13 5v2M13 11v2M13 17v2"/>',
    agents: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.5c1.9.8 3 2.7 3 5.5"/>',
    hub: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
    chart: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
    users: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    crm: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    card: '<rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>',
    ledger: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h4M8 17h7"/>',
    money: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    ads: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.4 5.6a9 9 0 0 1 0 12.8"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'
  };

  var NAV = [
    { s: 'Entreprise', items: [
      { h: '/symphony-hq', l: 'QG', i: 'hq', p: 'overview' },
      { h: '/symphony-hq#tasks', l: 'Tâches', i: 'tasks', p: 'overview', badge: true },
      { h: '/symphony-hq#team', l: 'Comptes & accès', i: 'team', p: 'team.view' },
      { h: '/symphony-hq#demand', l: 'Demande marché', i: 'demand', p: 'demand.view' } ] },
    { s: 'Opérations', items: [
      { h: '/symphony-tickets', l: 'Tickets', i: 'ticket', p: 'tickets.work' },
      { h: '/symphony-agents', l: 'Agents & équipes', i: 'agents', p: 'team.view' },
      { h: '/symphony', l: 'Hub opérations', i: 'hub', p: 'overview' },
      { h: '/symphony-analytics', l: 'Analytics', i: 'chart', p: 'analytics.view' } ] },
    { s: 'Médecins', items: [
      { h: '/symphony-kyc', l: 'KYC & onboarding', i: 'file', p: 'kyc.view' },
      { h: '/symphony-users', l: 'Médecins & cliniques', i: 'users', p: 'doctors.view' },
      { h: '/symphony-crm', l: 'Fiche médecin', i: 'crm', p: 'doctors.view' },
      { h: '/symphony-featured', l: 'En vedette', i: 'star', p: 'doctors.view' } ] },
    { s: 'Finance', items: [
      { h: '/symphony?tab=paiements', l: 'Paiements', i: 'card', p: 'payments.view' },
      { h: '/symphony-ledger', l: 'LedgerDesk', i: 'ledger', p: 'billing.view' },
      { h: '/symphony-revenue', l: 'Revenus', i: 'money', p: 'revenue.view' } ] },
    { s: 'Marketing', items: [
      { h: '/symphony-ads', l: 'Régie publicitaire', i: 'ads', p: 'marketing.view' },
      { h: '/symphony-emails', l: 'Emails & modèles', i: 'mail', p: 'marketing.view' } ] },
    { s: 'Système', items: [
      { h: '/symphony-simulate', l: 'Simulation', i: 'eye', p: 'simulate.use' },
      { h: '/symphony-security', l: 'Sécurité & journal', i: 'shield', p: 'security.view' },
      { h: '/symphony-settings', l: 'Paramètres', i: 'gear', p: 'settings.manage' } ] }
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clean(p) { return (p || '/').split(/[?#]/)[0].replace(/\.html$/, '').replace(/\/+$/, '') || '/'; }
  function svg(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function access() { return window.SymphonyAccess; }
  function can(p) { var a = access(); return !a || a.can(p); }

  function isOn(href) {
    var cur = clean(location.pathname), target = clean(href);
    if (cur !== target) return false;
    var hash = href.indexOf('#') !== -1 ? href.slice(href.indexOf('#')) : '';
    var tab = (href.split('?')[1] || '').replace(/^tab=/, '').split('#')[0];
    var curTab = new URLSearchParams(location.search).get('tab') || '';
    if (target === '/symphony-hq') return (location.hash || '') === hash || (!hash && /^#(overview)?$/.test(location.hash || '#'));
    if (target === '/symphony') return curTab === tab;
    return true;
  }

  function html() {
    var a = access(), me = a && a.me;
    var name = (me && (me.full_name || me.email)) || '';
    var role = (me && (me.title || me.department_label || me.email)) || 'Symphony';
    var ini = String(name || '?').trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(function (x) { return x[0].toUpperCase(); }).join('') || '?';
    var out = '<div class="sx-head" data-sx-mark="1"><img src="docline-logo-white.svg" alt="Docline"><span class="sx-tag">SYMPHONY</span></div><nav class="sx-nav" aria-label="Symphony">';
    NAV.forEach(function (sec) {
      var items = sec.items.filter(function (it) { return can(it.p); });
      if (!items.length) return;
      out += '<div class="sx-sec">' + esc(sec.s) + '</div>';
      items.forEach(function (it) {
        var on = isOn(it.h);
        out += '<a class="sx-link' + (on ? ' on' : '') + '" href="' + it.h + '"' + (on ? ' aria-current="page"' : '') + '>' + svg(it.i) + '<span>' + esc(it.l) + '</span>' +
          (it.badge ? '<b class="sx-badge" data-sx-badge hidden></b>' : '') + '</a>';
      });
    });
    out += '</nav><div class="sx-foot"><div class="sx-me"><div class="sx-me-av">' + esc(ini) + '</div><div class="sx-me-txt"><div class="sx-me-name">' + esc(name || 'Symphony') + '</div><div class="sx-me-role">' + esc(role) + '</div></div>' +
      '<button class="sx-out" type="button" data-sx-out title="Se déconnecter" aria-label="Se déconnecter">' + svg('out') + '</button></div></div>';
    return out;
  }

  function findSide() {
    return document.querySelector('[data-sx-chrome], #sx-side, #admin-sidebar, #sidebar.sidebar, aside.sidebar, nav.sidebar');
  }

  var rendering = false;
  function render() {
    var el = findSide();
    if (!el) return;
    rendering = true;
    el.setAttribute('data-sx-chrome', '1');
    el.innerHTML = html();
    rendering = false;
    var a = access();
    if (a && a.refreshBadge && a._badge != null) a.refreshBadge(a._badge);
  }

  function start() {
    document.body.classList.add('sx');
    render();
    // Une page qui redessine son ancien menu est aussitôt ramenée au menu commun
    var el = findSide();
    if (el) new MutationObserver(function () {
      if (!rendering && !el.querySelector('[data-sx-mark]')) render();
    }).observe(el, { childList: true });
    var a = access();
    if (a && a.ready) a.ready.then(render);
    window.addEventListener('hashchange', render);
    document.addEventListener('click', function (e) {
      var o = e.target.closest('[data-sx-out]');
      if (o) {
        var c = access() && access().client;
        (c ? c.auth.signOut() : Promise.resolve()).then(function () { location.href = '/login'; });
        return;
      }
      if (e.target.closest('[data-sx-ham]')) { var app = document.querySelector('.sx-app'); if (app) app.classList.toggle('sx-open'); }
      if (e.target.closest('.sx-scrim')) { var app2 = document.querySelector('.sx-app'); if (app2) app2.classList.remove('sx-open'); }
    });
  }

  window.SymphonyChrome = { render: render, NAV: NAV };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
