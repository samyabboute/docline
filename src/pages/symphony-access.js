/* Symphony — couche d'accès commune à toutes les pages internes Docline.
   - lit les permissions du membre connecté côté serveur (rpc symphony_me)
   - masque partout les liens vers les modules non autorisés
   - bloque l'accès direct à une page non autorisée
   - ajoute le groupe « Entreprise » (QG, tâches, équipe, demande) dans la barre latérale */
(function () {
  'use strict';

  var PAGE_PERMS = {
    '/symphony': 'overview', '/symphony-hq': 'overview',
    '/symphony-analytics': 'analytics.view', '/symphony-kyc': 'kyc.view',
    '/symphony-users': 'doctors.view', '/symphony-crm': 'doctors.view', '/symphony-featured': 'doctors.view',
    '/symphony-revenue': 'revenue.view', '/symphony-ads': 'marketing.view', '/symphony-emails': 'marketing.view',
    '/symphony-agents': 'team.view', '/symphony-simulate': 'simulate.use', '/symphony-security': 'security.view',
    '/symphony-settings': 'settings.manage', '/symphony-incidents': 'incidents.view', '/symphony-tickets': 'tickets.work', '/symphony-ledger': 'billing.view'
  };
  // Boutons internes du hub (sections affichées sans changer de page)
  var HUB_BUTTONS = { 'nav-paiements': 'payments.view', 'nav-equipe': 'team.view', 'nav-medecins': 'doctors.view' };

  var ICONS = {
    hq: '<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    tasks: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="m8 12 2.5 2.5L16 9"/>',
    team: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    demand: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'
  };
  var GROUP = [
    { href: '/symphony-hq', hash: '', label: 'QG', icon: 'hq', perm: 'overview' },
    { href: '/symphony-hq#tasks', hash: '#tasks', label: 'Tâches', icon: 'tasks', perm: 'overview', badge: true },
    { href: '/symphony-hq#team', hash: '#team', label: 'Équipe & accès', icon: 'team', perm: 'team.view' },
    { href: '/symphony-hq#demand', hash: '#demand', label: 'Demande marché', icon: 'demand', perm: 'demand.view' }
  ];

  var me;              // undefined = inconnu (migration absente), null = pas membre, objet = membre
  var client = null;

  function path(p) {
    return (p || '/').split(/[?#]/)[0].replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  }
  function can(perm) {
    if (me === undefined) return true;          // ancien fonctionnement tant que la migration n'est pas appliquée
    if (!me) return false;
    var perms = me.permissions || [];
    return perms.indexOf('*') !== -1 || perms.indexOf(perm) !== -1;
  }

  var resolveReady;
  var api = window.SymphonyAccess = {
    ready: new Promise(function (r) { resolveReady = r; }),
    can: can,
    get me() { return me; },
    get client() { return client; },
    PAGE_PERMS: PAGE_PERMS
  };

  function injectStyles() {
    if (document.getElementById('sx-access-css')) return;
    var css = document.createElement('style');
    css.id = 'sx-access-css';
    css.textContent =
      '.sx-group{padding:10px 8px 8px;border-bottom:1px solid rgba(255,255,255,.07);margin-bottom:2px}' +
      '.sx-label{padding:6px 8px 6px;font:700 10px/1 Inter,system-ui,sans-serif;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,.3)}' +
      '.sx-link{display:flex;align-items:center;gap:10px;padding:8px 10px;margin:1px 0;border-radius:10px;color:rgba(255,255,255,.62);font:500 13px/1.2 Inter,system-ui,sans-serif;text-decoration:none;transition:background .15s,color .15s;white-space:nowrap}' +
      '.sx-link:hover{background:rgba(255,255,255,.06);color:#fff}' +
      '.sx-link.on{background:rgba(124,58,237,.24);color:#fff;font-weight:600}' +
      '.sx-link svg{width:16px;height:16px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;opacity:.85}' +
      '.sx-badge{margin-left:auto;min-width:18px;text-align:center;background:#EA580C;color:#fff;font:800 10px/1 Inter,sans-serif;padding:3px 6px;border-radius:999px}' +
      '.sb-collapsed .sx-link span,.sb-collapsed .sx-label{display:none}' +
      '.sx-denied{position:fixed;inset:0;z-index:100000;background:#F7F6FF;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,system-ui,sans-serif}' +
      '.sx-denied-card{max-width:420px;text-align:center;background:#fff;border:1px solid rgba(0,0,0,.07);border-radius:20px;padding:36px 28px;box-shadow:0 20px 60px rgba(76,29,149,.1)}' +
      '.sx-denied-ic{width:56px;height:56px;margin:0 auto 18px;border-radius:16px;background:#FFF4ED;display:flex;align-items:center;justify-content:center}' +
      '.sx-denied-ic svg{width:26px;height:26px;fill:none;stroke:#EA580C;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
      '.sx-denied h1{font-size:20px;font-weight:800;color:#0D0520;margin:0 0 8px;letter-spacing:-.3px}' +
      '.sx-denied p{font-size:14px;color:#6B7280;line-height:1.6;margin:0 0 22px}' +
      '.sx-denied a{display:inline-flex;align-items:center;gap:8px;background:#4C1D95;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:999px}';
    document.head.appendChild(css);
  }

  function findSidebar() {
    return document.querySelector('#admin-sidebar, aside.sidebar, nav.sidebar, #sidebar.sidebar');
  }

  function buildGroup() {
    var cur = path(location.pathname), hash = location.hash || '';
    var g = document.createElement('div');
    g.className = 'sx-group';
    g.innerHTML = '<div class="sx-label">Entreprise</div>';
    GROUP.forEach(function (it) {
      if (!can(it.perm)) return;
      var a = document.createElement('a');
      a.className = 'sx-link';
      a.href = it.href;
      if (cur === '/symphony-hq' && hash === it.hash) a.classList.add('on');
      a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[it.icon] + '</svg><span></span>' +
        (it.badge ? '<b class="sx-badge" data-sx-badge hidden></b>' : '');
      a.querySelector('span').textContent = it.label;
      g.appendChild(a);
    });
    return g;
  }

  function ensureGroup() {
    if (me === null) return;
    if (path(location.pathname) === '/symphony-hq') return;  // le QG a sa propre navigation
    var sb = findSidebar();
    if (!sb || sb.hasAttribute('data-sx-chrome') || document.querySelector('[data-sx-chrome]') || sb.querySelector('.sx-group')) return;
    var head = sb.querySelector('[class*="sidebar-head"], .sb-head');
    var g = buildGroup();
    if (!g.querySelector('.sx-link')) return;
    if (head && head.parentNode === sb) sb.insertBefore(g, head.nextSibling);
    else sb.insertBefore(g, sb.firstChild);
    refreshBadge();
  }

  function hideForbidden() {
    document.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.indexOf('/symphony') !== 0 && href.indexOf('symphony') !== 0) return;
      var perm = PAGE_PERMS[path(href.charAt(0) === '/' ? href : '/' + href)];
      if (perm && !can(perm)) a.style.display = 'none';
    });
    Object.keys(HUB_BUTTONS).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !can(HUB_BUTTONS[id])) el.style.display = 'none';
    });
  }

  var badgeCount = null;
  function refreshBadge() {
    document.querySelectorAll('[data-sx-badge]').forEach(function (b) {
      b.hidden = !badgeCount;
      b.textContent = badgeCount || '';
    });
  }
  function loadBadge() {
    if (!client || !me) return;
    client.from('symphony_tasks').select('id', { count: 'exact', head: true })
      .eq('assignee_email', me.email).neq('status', 'done')
      .then(function (r) { if (r && !r.error) { badgeCount = r.count || 0; api._badge = badgeCount; refreshBadge(); } });
  }
  api.refreshBadge = function (n) { badgeCount = n; api._badge = n; refreshBadge(); };

  function deny() {
    var d = document.createElement('div');
    d.className = 'sx-denied';
    d.innerHTML = '<div class="sx-denied-card"><div class="sx-denied-ic"><svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>' +
      '<h1>Module non autorisé</h1><p>Votre poste ne donne pas accès à cette page. Si vous en avez besoin, demandez l’accès à votre responsable.</p>' +
      '<a href="/symphony-hq">Retour au QG</a></div>';
    document.body.appendChild(d);
  }

  function start() {
    injectStyles();
    var url = window.SUPA_URL || (window.DOCLINE_CONFIG && DOCLINE_CONFIG.SUPA_URL);
    var key = window.SUPA_KEY || (window.DOCLINE_CONFIG && DOCLINE_CONFIG.SUPA_KEY);
    if (!window.supabase || !url || !key) { resolveReady(undefined); return; }
    client = window.supabase.createClient(url, key, { auth: { storageKey: 'sb-' + url.split('//')[1].split('.')[0] + '-auth-token' } });

    client.rpc('symphony_me').then(function (r) {
      if (r.error) { me = undefined; }       // migration pas encore appliquée
      else if (!r.data) { me = null; }
      else if (typeof r.data === 'object' && Array.isArray(r.data.permissions)) { me = r.data; }
      else { me = undefined; }               // réponse inattendue : on ne masque rien
      if (me === null) {
        // Compte connecté mais pas membre de l'équipe
        var page = PAGE_PERMS[path(location.pathname)];
        if (page) { client.auth.getSession().then(function (s) { if (s.data && s.data.session) deny(); }); }
      } else {
        var need = PAGE_PERMS[path(location.pathname)];
        if (need && !can(need)) deny();
      }
      hideForbidden();
      ensureGroup();
      loadBadge();
      var t = null;
      new MutationObserver(function () {
        clearTimeout(t);
        t = setTimeout(function () { hideForbidden(); ensureGroup(); }, 60);
      }).observe(document.body, { childList: true, subtree: true });
      resolveReady(me);
    }, function () { resolveReady(undefined); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
