/**
 * Prospeo Shell — shared sidebar + topbar for all app pages
 * Usage: <script src="shell.js"></script>
 * Then call: Shell.init({ page: 'clients', title: 'Clients' })
 */
var Shell = (function() {
  'use strict';

  var LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 187.3" style="height:22px;width:auto;display:block"><path fill="currentColor" d="M112.46 9.26C103.11 3.64 92.46.82 80.51.82c-17.66 0-31.86 5.89-42.59 17.66L35.32 3.42H0v183.89h40.78v-68.05c10.56 13.41 24.49 20.12 41.7 20.12 11.95 0 22.6-2.96 31.95-8.84 9.35-5.89 16.65-14.18 21.89-24.9 5.24-10.71 7.86-23.01 7.86-36.88 0-13.87-2.62-26.06-7.86-36.6-5.24-10.54-12.54-18.73-21.89-24.62h.09zM95.6 105.15c-5.89 9.07-14.33 13.6-25.32 13.6-10.99 0-19.43-4.53-25.32-13.6C38.89 97.29 35.94 87 35.94 75.41c0-11.59 2.95-21.89 8.84-29.74 5.89-7.86 14.33-11.79 25.32-11.79s19.43 3.93 25.32 11.79c5.89 7.86 8.84 18.15 8.84 29.74.09 11.59-2.86 21.88-8.66 29.74zM228.82.82c-13.87 0-26.17 2.95-36.88 8.84-10.71 5.89-19.07 14.27-24.9 25.13-5.89 10.89-8.84 23.54-8.84 37.95v114.57h40.78v-64.79c9.62 11.32 22.78 16.97 39.52 16.97 13.23 0 24.9-2.95 35.08-8.84s18.15-14.27 23.99-25.13c5.8-10.89 8.75-23.36 8.75-37.41 0-14.06-2.95-26.52-8.75-37.41-5.89-10.89-14.06-19.43-24.62-25.58C262.39 3.95 246.48.82 228.82.82zm17.66 104.33c-5.89 9.07-14.33 13.6-25.32 13.6-10.99 0-19.43-4.53-25.32-13.6-5.89-9.07-8.84-19.34-8.84-30.93 0-11.59 2.95-21.89 8.84-29.74 5.89-7.86 14.33-11.79 25.32-11.79s19.43 3.93 25.32 11.79c5.89 7.86 8.84 18.15 8.84 29.74 0 11.59-2.95 21.86-8.84 30.93zM396.71 0c-22.6 0-40.6 6.07-54.03 18.24-13.43 12.16-20.12 29.19-20.12 50.97v117.9h40.78V74.25c0-11.41 3.04-20.3 9.12-26.52 6.07-6.25 14.36-9.35 24.9-9.35 6.43 0 11.68.89 15.61 2.68l10.09-38.55C417.28 1.01 407.7 0 396.71 0zM519.41 0c-15.55 0-28.97 2.86-40.33 8.57-11.32 5.71-20.12 13.87-26.35 24.49-6.25 10.63-9.35 23.1-9.35 37.5v116.65h40.78V74.25c0-11.41 3.04-20.3 9.12-26.52 6.07-6.25 14.36-9.35 24.9-9.35 10.54 0 18.83 3.13 24.9 9.35 6.07 6.25 9.12 15.11 9.12 26.52v112.96h40.78V70.56c0-14.36-3.13-26.88-9.35-37.5-6.25-10.63-14.99-18.79-26.35-24.49C546.29 2.86 533.87 0 519.41 0zM677.9 0c-15.49 0-29.46 3.69-41.91 11.06-12.43 7.37-22.24 17.57-29.37 30.57-7.13 13-10.71 27.72-10.71 44.15 0 16.43 3.58 31.06 10.71 43.97 7.13 12.9 16.92 23.01 29.37 30.22 12.43 7.22 26.35 10.8 41.91 10.8 15.46 0 29.19-3.58 41.16-10.8 11.97-7.22 21.35-17.31 28.04-30.22 6.69-12.9 10.01-27.54 10.01-43.97 0-16.43-3.31-31.15-10.01-44.15-6.69-13-16.06-23.19-28.04-30.57C707.09 3.69 693.36 0 677.9 0zm24.9 110.08c-6.34 9.17-15.14 13.77-26.35 13.77-11.32 0-20.3-4.6-26.88-13.77-6.61-9.17-9.88-20.66-9.88-34.3 0-13.64 3.27-25.04 9.88-34.12 6.61-9.07 15.61-13.6 26.88-13.6 11.23 0 20.01 4.53 26.35 13.6 6.34 9.07 9.47 20.48 9.47 34.12.09 13.64-3.13 25.13-9.47 34.3zM840.22 0c-15.55 0-28.97 2.86-40.33 8.57-11.32 5.71-20.12 13.87-26.35 24.49-6.25 10.63-9.35 23.1-9.35 37.5v116.65h40.78V74.25c0-11.41 3.04-20.3 9.12-26.52 6.07-6.25 14.36-9.35 24.9-9.35 10.54 0 18.83 3.13 24.9 9.35 6.07 6.25 9.12 15.11 9.12 26.52v112.96h40.78V70.56c0-14.36-3.13-26.88-9.35-37.5-6.25-10.63-14.99-18.79-26.35-24.49C868.2 2.86 855.69 0 840.22 0zM988.82 62.29c-6.43-3.84-15.7-6.96-27.84-9.35-8.75-1.79-15.23-3.67-19.43-5.71-4.18-2.04-6.25-5.09-6.25-9.12 0-3.84 1.52-6.96 4.53-9.35 3.04-2.39 7.86-3.58 14.45-3.58 12.43 0 21.89 4.62 28.41 13.86l30.31-18.72c-5.71-9.17-13.6-16.39-23.54-21.71C979.5 3.4 967.6.76 954.28.76c-11.59 0-21.89 2.13-30.93 6.34-9.07 4.18-16.21 10.09-21.35 17.75-5.17 7.66-7.75 16.56-7.75 26.7 0 10.99 2.77 20.01 8.31 27.0 5.53 6.96 12.51 12.07 20.93 15.32 8.4 3.27 18.24 5.89 29.46 7.86 8.4 1.52 14.54 3.49 18.42 5.89 3.84 2.39 5.8 5.8 5.8 10.18 0 4.01-1.79 7.22-5.33 9.53-3.58 2.33-8.4 3.49-14.45 3.49-8.4 0-15.79-1.96-22.19-5.89-6.43-3.93-11.41-9.44-14.98-16.56l-31.19 19.43c5.89 11.32 14.9 20.3 27.0 26.97 12.07 6.69 26.26 10.0 42.38 10.0 12.16 0 23.1-2.04 32.72-6.16 9.62-4.09 17.13-10.0 22.6-17.66 5.44-7.66 8.18-16.65 8.18-26.97.09-10.54-3.04-19.25-9.09-25.69z"/></svg>';

  var NAV = [
    {href:'app.html',    key:'dashboard', label:'Tableau de bord',
      icon:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'},
    {href:'clients.html',key:'clients',   label:'Clients',
      icon:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'},
    {href:'proposals.html',key:'proposals',label:'Smart Files',
      icon:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'},
    {href:'invoices.html',key:'invoices', label:'Factures',
      icon:'<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'},
    {href:'calendar.html',key:'calendar', label:'Agenda',
      icon:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'},
    {href:'recurring.html',key:'recurring',label:'Récurrents',
      icon:'<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'},
    {href:'timer.html',key:'timer',label:'Suivi du temps',
      icon:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'},
  ];

  var CSS = `
<style id="shell-css">
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --brand:#003399;--brand2:#1D4ED8;--brand-light:#EEF2FF;--brand-border:rgba(0,51,153,.2);
  --sidebar-w:220px;--topbar-h:56px;
  --bg:#F8FAFF;--surface:#FFFFFF;--surface2:#F3F4F6;
  --text:#0D1117;--text2:#374151;--text3:#6B7280;--text4:#9CA3AF;
  --border:#E5E7EB;--border2:rgba(0,0,0,.06);
  --success:#059669;--warning:#D97706;--danger:#DC2626;--purple:#7C3AED;
  --shadow:0 1px 4px rgba(0,0,0,.06);--shadow-md:0 4px 16px rgba(0,0,0,.08);
  --r:8px;--rlg:12px;--rfull:999px;
  --ease:cubic-bezier(.25,.46,.45,.94);--t:.2s;
  --sidebar-bg:#FFFFFF;--sidebar-border:#E5E7EB;--sidebar-text:#374151;
  --topbar-bg:rgba(255,255,255,.92);
}
[data-theme="dark"]{
  --bg:#0D1117;--surface:#111827;--surface2:#1F2937;
  --text:#F9FAFB;--text2:#D1D5DB;--text3:#9CA3AF;--text4:#6B7280;
  --border:rgba(255,255,255,.08);--border2:rgba(255,255,255,.04);
  --brand-light:rgba(0,51,153,.2);--brand-border:rgba(0,51,153,.4);
  --shadow:0 1px 4px rgba(0,0,0,.3);--shadow-md:0 4px 16px rgba(0,0,0,.4);
  --sidebar-bg:#111827;--sidebar-border:rgba(255,255,255,.06);--sidebar-text:#D1D5DB;
  --topbar-bg:rgba(17,24,39,.92);
}
html{-webkit-font-smoothing:antialiased;font-size:16px}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',sans-serif;background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh}

/* ── APP SHELL ── */
.app-shell{display:grid;grid-template-columns:var(--sidebar-w) 1fr;grid-template-rows:var(--topbar-h) 1fr;min-height:100vh}
.shell-sidebar{grid-row:1/-1;grid-column:1;background:var(--sidebar-bg);border-right:1px solid var(--sidebar-border);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto;overflow-x:hidden;z-index:200;transition:transform var(--t) var(--ease)}
.shell-topbar{grid-row:1;grid-column:2;background:var(--topbar-bg);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);height:var(--topbar-h);display:flex;align-items:center;padding:0 20px;gap:12px;position:sticky;top:0;z-index:100;transition:box-shadow var(--t)}
.shell-topbar.scrolled{box-shadow:var(--shadow-md)}
.shell-main{grid-row:2;grid-column:2;min-width:0;overflow-x:hidden}
.shell-page{padding:24px;max-width:1400px}

/* ── SIDEBAR INTERNALS ── */
.sb-head{padding:16px 14px 8px;border-bottom:1px solid var(--sidebar-border);flex-shrink:0}
.sb-logo{display:flex;align-items:center;gap:10px;padding:6px 0}
.sb-logo-img{color:var(--text);flex-shrink:0}
.sb-plan{font-size:10px;font-weight:700;padding:2px 7px;border-radius:var(--rfull);letter-spacing:.04em;margin-left:auto}
.sb-plan.pro{background:rgba(5,150,105,.12);color:#059669}
.sb-plan.free{background:var(--surface2);color:var(--text4)}
.sb-nav{padding:8px 8px;flex:1}
.sb-section{font-size:10px;font-weight:600;color:var(--text4);letter-spacing:.08em;text-transform:uppercase;padding:10px 8px 4px}
.sb-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:var(--r);font-size:13px;font-weight:500;color:var(--sidebar-text);text-decoration:none;border:none;background:none;cursor:pointer;width:100%;text-align:left;font-family:inherit;transition:background var(--t),color var(--t);white-space:nowrap;overflow:hidden}
.sb-item svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;flex-shrink:0;opacity:.7}
.sb-item:hover{background:var(--brand-light);color:var(--brand)}
.sb-item:hover svg{opacity:1}
.sb-item:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
.sb-item.active{background:var(--brand-light);color:var(--brand);font-weight:600}
.sb-item.active svg{opacity:1;stroke:var(--brand)}
.sb-item.locked{opacity:.5;cursor:not-allowed}
.sb-divider{height:1px;background:var(--border);margin:8px 0}
.sb-usage{padding:10px 14px;margin-top:auto}
.sb-usage-label{font-size:11px;color:var(--text3);margin-bottom:5px;display:flex;justify-content:space-between}
.sb-usage-bar{height:4px;background:var(--border);border-radius:2px;overflow:hidden}
.sb-usage-fill{height:100%;border-radius:2px;background:var(--brand);transition:width .4s}
.sb-usage-fill.warn{background:var(--warning)}
.sb-usage-fill.danger{background:var(--danger)}
.sb-upgrade{display:block;margin:8px 0;text-align:center;background:var(--brand);color:#fff;text-decoration:none;padding:8px 14px;border-radius:var(--rfull);font-size:12px;font-weight:600;transition:opacity var(--t)}
.sb-upgrade:hover{opacity:.88}
.sb-footer{padding:10px 10px;border-top:1px solid var(--sidebar-border);flex-shrink:0}
.sb-user{display:flex;align-items:center;gap:9px;padding:8px 8px;border-radius:var(--r);cursor:pointer;transition:background var(--t)}
.sb-user:hover{background:var(--surface2)}
.sb-avatar{width:30px;height:30px;border-radius:50%;background:var(--brand-light);color:var(--brand);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sb-username{font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-email{font-size:10px;color:var(--text4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:199;display:none;backdrop-filter:blur(2px)}
.sb-overlay.open{display:block}

/* ── TOPBAR INTERNALS ── */
.tb-hamburger{display:none;background:none;border:none;cursor:pointer;padding:6px;border-radius:var(--r);color:var(--text2);-webkit-tap-highlight-color:transparent}
.tb-hamburger svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.tb-title{font-size:15px;font-weight:600;color:var(--text)}
.tb-spacer{flex:1}
.tb-search{display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--rfull);padding:6px 14px;max-width:260px;flex:1;transition:border-color var(--t)}
.tb-search:focus-within{border-color:var(--brand);background:var(--surface)}
.tb-search svg{width:14px;height:14px;fill:none;stroke:var(--text4);stroke-width:2;stroke-linecap:round;flex-shrink:0}
.tb-search input{border:none;background:none;outline:none;font-size:13px;color:var(--text);width:100%;font-family:inherit}
.tb-search input::placeholder{color:var(--text4)}
.tb-actions{display:flex;align-items:center;gap:4px;margin-left:8px}
.tb-icon-btn{width:34px;height:34px;border-radius:var(--r);border:none;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text3);transition:background var(--t),color var(--t);position:relative;-webkit-tap-highlight-color:transparent}
.tb-icon-btn:hover{background:var(--surface2);color:var(--text)}
.tb-icon-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.tb-notif-badge{position:absolute;top:5px;right:5px;width:7px;height:7px;border-radius:50%;background:var(--danger);border:2px solid var(--topbar-bg);display:none}
.tb-notif-badge.show{display:block}
.tb-avatar{width:30px;height:30px;border-radius:50%;background:var(--brand-light);color:var(--brand);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px solid transparent;transition:border-color var(--t)}
.tb-avatar:hover{border-color:var(--brand)}

/* ── MOBILE ── */
.shell-mobile-nav{display:none;position:fixed;bottom:0;left:0;right:0;height:58px;background:var(--surface);border-top:1px solid var(--border);z-index:500;padding:0 calc(env(safe-area-inset-bottom,0px) + 4px)}
.smn-row{display:flex;height:100%;align-items:stretch}
.smn-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;text-decoration:none;color:var(--text4);border:none;background:none;cursor:pointer;font-family:inherit;padding:6px 2px;-webkit-tap-highlight-color:transparent;transition:color .12s;position:relative;font-size:9px;font-weight:600;letter-spacing:.01em}
.smn-item svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
.smn-item.active{color:var(--brand)}
.smn-item.active::after{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:20px;height:2px;background:var(--brand);border-radius:0 0 2px 2px}

/* ── THEME TOGGLE ── */
.theme-toggle{width:34px;height:34px;border-radius:var(--r);border:none;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text3);transition:background var(--t),color var(--t)}
.theme-toggle:hover{background:var(--surface2);color:var(--text)}
.theme-toggle svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}

/* ── RESPONSIVE ── */
@media(max-width:768px){
  :root{--sidebar-w:0px;--topbar-h:52px}
  .app-shell{grid-template-columns:1fr}
  .shell-sidebar{position:fixed;left:0;top:0;bottom:0;width:260px;transform:translateX(-100%);transition:transform .25s var(--ease);z-index:300}
  .shell-sidebar.open{transform:translateX(0)}
  .shell-topbar{grid-column:1}
  .shell-main{grid-column:1;grid-row:2}
  .shell-page{padding:14px;padding-bottom:72px}
  .tb-hamburger{display:flex}
  .tb-search{display:none}
  .shell-mobile-nav{display:flex}
}
@media(max-width:1024px){
  :root{--sidebar-w:200px}
  .sb-item span{font-size:12px}
}
@media(min-width:769px){
  .shell-sidebar{transform:none!important}
}
</style>`;

  // ── THEME ─────────────────────────────────────────────────────
  var _theme = localStorage.getItem('prospeo-theme') || 'light';

  function applyTheme(t) {
    _theme = t;
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('prospeo-theme', t);
    var icons = document.querySelectorAll('.theme-icon-moon,.theme-icon-sun');
    icons.forEach(function(ic) {
      if (ic.classList.contains('theme-icon-moon')) ic.style.display = t === 'dark' ? 'none' : 'block';
      if (ic.classList.contains('theme-icon-sun')) ic.style.display = t === 'dark' ? 'block' : 'none';
    });
  }

  function toggleTheme() {
    applyTheme(_theme === 'dark' ? 'light' : 'dark');
  }

  // ── INJECT CSS IMMEDIATELY ────────────────────────────────────
  (function injectCSS() {
    if (!document.getElementById('shell-css')) {
      var div = document.createElement('div');
      div.innerHTML = CSS;
      var style = div.querySelector('style');
      if (document.head) document.head.appendChild(style);
      else document.write(CSS);
    }
  })();

  // ── RENDER ────────────────────────────────────────────────────
  function render(opts) {
    opts = opts || {};
    var page = opts.page || 'dashboard';
    var title = opts.title || 'Dashboard';
    var isPro = opts.isPro || false;
    var userName = opts.userName || '';
    var userEmail = opts.userEmail || '';
    var initials = userName ? userName.split(' ').map(function(w){return w[0]||'';}).join('').toUpperCase().slice(0,2) : (userEmail[0]||'?').toUpperCase();
    var leadCount = opts.leadCount || 0;
    var leadLimit = isPro ? 9999 : 10;
    var pct = Math.min(100, Math.round((leadCount/leadLimit)*100));

    // Sidebar HTML
    var navHTML = NAV.map(function(n) {
      var active = n.key === page ? ' active' : '';
      return '<a href="'+n.href+'" class="sb-item'+active+'" data-key="'+n.key+'">' +
        '<svg viewBox="0 0 24 24">'+n.icon+'</svg><span>'+n.label+'</span></a>';
    }).join('');

    var usageHTML = !isPro ? (
      '<div class="sb-divider"></div>' +
      '<div class="sb-usage">' +
        '<div class="sb-usage-label"><span>Leads utilisés</span><span>'+leadCount+'/'+leadLimit+'</span></div>' +
        '<div class="sb-usage-bar"><div class="sb-usage-fill'+(pct>80?' warn':'')+(pct>=100?' danger':'')+'" style="width:'+pct+'%"></div></div>' +
        '<a href="pricing.html" class="sb-upgrade">⚡ Passer en Pro</a>' +
      '</div>'
    ) : '';

    var sidebarHTML = 
      '<div class="sb-head">' +
        '<div class="sb-logo">' +
          '<div class="sb-logo-img">'+LOGO_SVG+'</div>' +
          '<span class="sb-plan '+(isPro?'pro':'free')+'">'+(isPro?'PRO':'FREE')+'</span>' +
        '</div>' +
      '</div>' +
      '<nav class="sb-nav">' +
        '<div class="sb-section">Espace de travail</div>' +
        navHTML +
      '</nav>' +
      usageHTML +
      '<div class="sb-footer">' +
        '<div class="sb-user" onclick="if(typeof Auth!==\'undefined\')Auth.signOut()" title="Se déconnecter">' +
          '<div class="sb-avatar">'+initials+'</div>' +
          '<div style="min-width:0;flex:1">' +
            '<div class="sb-username">'+(userName||userEmail||'Account')+'</div>' +
            '<div class="sb-email">'+(userEmail||'Cliquer pour se déconnecter')+'</div>' +
          '</div>' +
          '<svg style="width:14px;height:14px;flex-shrink:0;opacity:.4;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
        '</div>' +
      '</div>';

    // Topbar HTML
    var topbarHTML = 
      '<button class="tb-hamburger" id="tb-ham" aria-label="Menu">' +
        '<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' +
      '</button>' +
      '<span class="tb-title">'+title+'</span>' +
      '<div class="tb-spacer"></div>' +
      '<div class="tb-search">' +
        '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<input id="shell-search" type="search" placeholder="Rechercher…" autocomplete="off">' +
      '</div>' +
      '<div class="tb-actions">' +
        '<button class="theme-toggle" onclick="Shell.toggleTheme()" title="Changer le thème">' +
          '<svg class="theme-icon-moon" viewBox="0 0 24 24" style="display:'+(_theme==='dark'?'none':'block')+'"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' +
          '<svg class="theme-icon-sun" viewBox="0 0 24 24" style="display:'+(_theme==='dark'?'block':'none')+'"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>' +
        '</button>' +
        '<button class="tb-icon-btn" id="tb-notif" title="Notifications">' +
          '<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
          '<span class="tb-notif-badge" id="notif-badge"></span>' +
        '</button>' +
        '<div class="tb-avatar" id="tb-avatar">'+initials+'</div>' +
      '</div>';

    // Mobile bottom nav
    var mobileNavHTML = '<nav class="shell-mobile-nav"><div class="smn-row">' +
      NAV.slice(0,5).map(function(n) {
        var active = n.key === page ? ' active' : '';
        return '<a href="'+n.href+'" class="smn-item'+active+'">' +
          '<svg viewBox="0 0 24 24">'+n.icon+'</svg>' +
          '<span>'+n.label+'</span></a>';
      }).join('') +
      '</div></nav>';

    return { sidebar: sidebarHTML, topbar: topbarHTML, mobileNav: mobileNavHTML };
  }

  // ── INIT ──────────────────────────────────────────────────────
  function init(opts) {
    applyTheme(_theme);

    var sidebarEl = document.getElementById('shell-sidebar');
    var topbarEl = document.getElementById('shell-topbar');
    var overlayEl = document.getElementById('shell-overlay');

    if (!sidebarEl || !topbarEl) {
      console.warn('[Shell] Missing #shell-sidebar or #shell-topbar elements');
      return;
    }

    var html = render(opts);
    sidebarEl.innerHTML = html.sidebar;
    topbarEl.innerHTML = html.topbar;

    // Mobile nav
    if (!document.getElementById('shell-mobile-nav')) {
      var mn = document.createElement('div');
      mn.id = 'shell-mobile-nav';
      mn.innerHTML = html.mobileNav;
      document.body.appendChild(mn.firstElementChild);
    }

    // Hamburger toggle
    var ham = document.getElementById('tb-ham');
    var sidebar = document.getElementById('shell-sidebar');
    var overlay = document.getElementById('shell-overlay');
    if (ham && sidebar) {
      ham.addEventListener('click', function() {
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('open');
      });
    }
    if (overlay && sidebar) {
      overlay.addEventListener('click', function() {
        sidebar.classList.remove('open');
        overlay.classList.remove('open');
      });
    }

    // Topbar scroll shadow
    window.addEventListener('scroll', function() {
      var tb = document.getElementById('shell-topbar');
      if (tb) tb.classList.toggle('scrolled', window.scrollY > 4);
    }, { passive: true });

    // Search delegation (page can override)
    var searchEl = document.getElementById('shell-search');
    if (searchEl && opts.onSearch) {
      searchEl.addEventListener('input', function(e) { opts.onSearch(e.target.value.trim()); });
    }
  }

  return {
    init: init,
    toggleTheme: toggleTheme,
    applyTheme: applyTheme,
    getTheme: function() { return _theme; },
    render: render,
  };
})();

// Apply theme immediately on script load (no FOUC)
(function() {
  var t = localStorage.getItem('prospeo-theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
