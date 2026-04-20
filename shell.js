/**
 * Prospeo Shell v2 — sidebar + topbar partagés
 * Usage: Shell.init({ page: 'queue', title: 'File d\'attente', isPro, userName, userEmail })
 */
var Shell = (function () {
  'use strict';

  // ── LOGO ──────────────────────────────────────────────────────
  var LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 520" style="width:28px;height:28px;flex-shrink:0"><rect width="520" height="520" rx="120" fill="#003399"/><path fill="#fff" d="M196.92,288.16c-5.41-3.9-13.29-6.24-23.63-7.02-3.61-.39-6.17-.97-7.68-1.75-1.51-.78-2.27-1.9-2.27-3.37,0-3.51,3.71-5.27,11.12-5.27s14,1.56,19.46,4.68l8.92-15.36c-3.71-2.44-8.12-4.34-13.24-5.71-5.12-1.36-10.51-2.05-16.17-2.05-9.95,0-17.85,2.12-23.7,6.37-5.85,4.24-8.78,9.98-8.78,17.19,0,6.63,2.71,12,8.12,16.09,5.41,4.1,12.7,6.39,21.88,6.88,4.1.29,7.02.88,8.78,1.76,1.76.88,2.63,2.19,2.63,3.95,0,3.41-3.17,5.12-9.51,5.12-4.59,0-9.19-.58-13.83-1.75-4.63-1.17-8.71-2.83-12.22-4.97l-8.78,15.8c9.46,6.44,20.58,9.66,33.36,9.66,10.54,0,18.78-2.12,24.73-6.37,5.95-4.24,8.92-10.07,8.92-17.48,0-7.02-2.71-12.49-8.12-16.39Z"/><path fill="#fff" d="M278.53,257.5c-5.27-3.17-11.27-4.75-18-4.75-9.95,0-17.95,3.32-24,9.95l-1.46-8.49h-19.9v103.59h22.97v-38.34c5.95,5.66,13.41,8.49,22.39,8.49,6.73,0,12.73-1.58,18-4.75,5.27-3.17,9.36-7.61,12.29-13.32,2.93-5.71,4.39-12.22,4.39-19.53s-1.46-13.83-4.39-19.53c-2.92-5.71-7.02-10.14-12.29-13.32ZM267.56,303.6c-3.22,3.36-7.36,5.05-12.44,5.05s-9.2-1.7-12.37-5.12c-3.17-3.41-4.75-7.8-4.75-13.17s1.58-9.75,4.75-13.17c3.17-3.41,7.29-5.12,12.37-5.12s9.22,1.68,12.44,5.05c3.22,3.36,4.83,7.78,4.83,13.24s-1.61,9.88-4.83,13.24Z"/><path fill="#fff" d="M363.54,257.07c-5.76-2.97-12.58-4.46-20.49-4.46s-14.48,1.59-20.34,4.76c-5.85,3.17-10.41,7.63-13.68,13.39-3.27,5.76-4.9,12.34-4.9,19.75s1.66,14.39,4.97,20.04c3.31,5.66,8.05,10.02,14.19,13.1,6.15,3.07,13.41,4.61,21.8,4.61,6.34,0,12.31-1.02,17.92-3.07,5.61-2.05,10.46-4.97,14.56-8.78l-12-12.87c-2.44,1.95-5.36,3.46-8.78,4.53-3.41,1.08-6.93,1.61-10.53,1.61-5.17,0-9.42-1.14-12.73-3.44-3.32-2.29-5.32-5.29-6-9h53.11c.49-3.41.73-6.29.73-8.63,0-7.22-1.54-13.54-4.61-18.95-3.07-5.41-7.49-9.61-13.24-12.58ZM327.69,284.06c.39-4.19,2.02-7.46,4.9-9.8,2.88-2.34,6.61-3.51,11.2-3.51s8.41,1.17,11.19,3.51c2.78,2.34,4.32,5.61,4.61,9.8h-31.9Z"/></svg>';

  // ── NAV ───────────────────────────────────────────────────────
  var NAV = [
    { href:'app.html',           key:'dashboard',    label:'Tableau de bord',
      icon:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>' },
    { href:'queue.html',         key:'queue',        label:"File d'attente", featured:true,
      icon:'<path d="M9 12h.01M12 12h.01M15 12h.01M12 8c-4.418 0-8 1.79-8 4s3.582 4 8 4 8-1.79 8-4-3.582-4-8-4z"/><path d="M4 12v4c0 2.21 3.582 4 8 4s8-1.79 8-4v-4"/>' },
    { href:'clients.html',       key:'clients',      label:'Patients',
      icon:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { href:'consultations.html', key:'consultations',label:'Consultations',
      icon:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' },
    { href:'calendar.html',      key:'calendar',     label:'Agenda',
      icon:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    { href:'ordonnances.html',   key:'ordonnances',  label:'Ordonnances',
      icon:'<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/>' },
    { href:'staff.html',         key:'staff',        label:'Personnel',
      icon:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="23" y2="8"/><line x1="21" y1="6" x2="21" y2="10"/>' },
    { href:'labo.html',          key:'labo',         label:'Laboratoire',
      icon:'<path d="M6 2v6l-2 4v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8l-2-4V2"/><line x1="6" y1="10" x2="14" y2="10"/>' },
  ];

  // ── CSS ───────────────────────────────────────────────────────
  var CSS = `<style id="shell-css">
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --brand:#003399;
  --brand-hover:#002580;
  --brand-subtle:#EEF2FF;
  --brand-border:rgba(0,51,153,.15);

  --bg:#F7F8FC;
  --surface:#FFFFFF;
  --surface-hover:#F3F4F8;

  --text:#0C0E14;
  --text-2:#3D4251;
  --text-3:#7B8194;
  --text-4:#B0B7CC;

  --border:#E8EAF0;
  --border-strong:#D0D4E0;

  --success:#059669;
  --success-bg:#F0FDF9;
  --warning:#D97706;
  --warning-bg:#FFFBEB;
  --danger:#DC2626;
  --danger-bg:#FFF5F5;

  --sidebar-w:228px;
  --topbar-h:54px;
  --r:8px;
  --r-sm:6px;
  --r-lg:12px;
  --rfull:999px;
  --t:.15s;
  --ease:cubic-bezier(.4,0,.2,1);
  --shadow-sm:0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);
  --shadow-md:0 4px 12px rgba(0,0,0,.08),0 2px 4px rgba(0,0,0,.04);
}

html{-webkit-font-smoothing:antialiased;font-size:16px;height:100%}
body{font-family:'Sora',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh}
a{color:inherit;text-decoration:none}
button{font-family:inherit;cursor:pointer}

/* ── SHELL GRID ── */
.app-shell{display:grid;grid-template-columns:var(--sidebar-w) 1fr;grid-template-rows:var(--topbar-h) 1fr;min-height:100vh}

/* ── SIDEBAR ── */
.shell-sidebar{
  grid-row:1/-1;grid-column:1;
  background:var(--surface);
  border-right:1px solid var(--border);
  display:flex;flex-direction:column;
  position:sticky;top:0;height:100vh;
  overflow-y:auto;overflow-x:hidden;
  z-index:200;
}

/* head */
.sb-head{
  display:flex;align-items:center;gap:10px;
  padding:18px 16px 14px;
  border-bottom:1px solid var(--border);
  flex-shrink:0;
}
.sb-wordmark{font-size:15px;font-weight:800;letter-spacing:-.4px;color:var(--text)}
.sb-plan{
  margin-left:auto;font-size:10px;font-weight:700;
  padding:2px 8px;border-radius:var(--rfull);letter-spacing:.04em;
  flex-shrink:0;
}
.sb-plan.pro{background:rgba(5,150,105,.1);color:#059669}
.sb-plan.free{background:var(--surface-hover);color:var(--text-3)}
.sb-plan.enterprise{background:rgba(0,51,153,.1);color:var(--brand)}

/* nav */
.sb-nav{padding:10px 10px;flex:1;display:flex;flex-direction:column;gap:1px}
.sb-section{
  font-size:10px;font-weight:700;color:var(--text-4);
  letter-spacing:.1em;text-transform:uppercase;
  padding:10px 8px 5px;margin-top:4px;
}
.sb-item{
  display:flex;align-items:center;gap:9px;
  padding:8px 10px;border-radius:var(--r);
  font-size:13px;font-weight:500;color:var(--text-2);
  text-decoration:none;border:none;background:none;
  width:100%;text-align:left;font-family:inherit;
  transition:background var(--t) var(--ease), color var(--t) var(--ease);
  white-space:nowrap;overflow:hidden;
}
.sb-item svg{
  width:15px;height:15px;flex-shrink:0;
  fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;
  opacity:.55;transition:opacity var(--t);
}
.sb-item:hover{background:var(--surface-hover);color:var(--text)}
.sb-item:hover svg{opacity:.8}

/* active */
.sb-item.active{
  background:var(--brand-subtle);color:var(--brand);font-weight:600;
}
.sb-item.active svg{opacity:1;stroke:var(--brand)}

/* featured (file d'attente) */
.sb-item.featured{
  color:var(--brand);font-weight:600;
  background:var(--brand-subtle);
  position:relative;
}
.sb-item.featured::before{
  content:'';position:absolute;left:0;top:6px;bottom:6px;
  width:3px;border-radius:0 3px 3px 0;background:var(--brand);
}
.sb-item.featured svg{opacity:1;stroke:var(--brand)}
.sb-item.featured:hover{background:rgba(0,51,153,.12)}
.sb-item.featured.active{
  background:var(--brand);color:#fff;
}
.sb-item.featured.active::before{display:none}
.sb-item.featured.active svg{stroke:#fff;opacity:1}

/* usage */
.sb-divider{height:1px;background:var(--border);margin:6px 10px}
.sb-usage{padding:10px 12px 6px}
.sb-usage-label{
  font-size:11px;color:var(--text-3);
  margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;
}
.sb-usage-label strong{font-weight:700;color:var(--text-2)}
.sb-usage-bar{height:4px;background:var(--border);border-radius:var(--rfull);overflow:hidden}
.sb-usage-fill{height:100%;border-radius:var(--rfull);background:var(--brand);transition:width .5s var(--ease)}
.sb-usage-fill.warn{background:var(--warning)}
.sb-usage-fill.danger{background:var(--danger)}
.sb-upgrade{
  display:flex;align-items:center;justify-content:center;gap:6px;
  margin-top:10px;width:100%;padding:9px 14px;
  background:var(--brand);color:#fff;border:none;border-radius:var(--r);
  font-size:12px;font-weight:700;font-family:inherit;
  cursor:pointer;text-decoration:none;
  transition:background var(--t);
}
.sb-upgrade:hover{background:var(--brand-hover)}
.sb-upgrade svg{width:13px;height:13px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round}

/* footer / user */
.sb-footer{padding:10px;border-top:1px solid var(--border);flex-shrink:0;margin-top:auto}
.sb-user{
  display:flex;align-items:center;gap:9px;
  padding:8px 8px;border-radius:var(--r);
  cursor:pointer;transition:background var(--t);
}
.sb-user:hover{background:var(--surface-hover)}
.sb-avatar{
  width:30px;height:30px;border-radius:50%;
  background:var(--brand-subtle);color:var(--brand);
  font-size:11px;font-weight:800;letter-spacing:.5px;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
.sb-user-info{min-width:0;flex:1}
.sb-username{font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-email{font-size:10px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.sb-signout{
  width:26px;height:26px;border-radius:var(--r-sm);border:none;background:none;
  display:flex;align-items:center;justify-content:center;
  color:var(--text-4);flex-shrink:0;transition:background var(--t),color var(--t);
}
.sb-signout:hover{background:var(--danger-bg);color:var(--danger)}
.sb-signout svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}

/* overlay */
.sb-overlay{
  position:fixed;inset:0;background:rgba(10,12,20,.35);
  backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);
  z-index:199;display:none;
}
.sb-overlay.open{display:block}

/* ── TOPBAR ── */
.shell-topbar{
  grid-row:1;grid-column:2;
  height:var(--topbar-h);background:var(--surface);
  border-bottom:1px solid var(--border);
  display:flex;align-items:center;padding:0 20px;gap:12px;
  position:sticky;top:0;z-index:100;
}
.shell-topbar.scrolled{box-shadow:var(--shadow-sm)}
.tb-ham{
  display:none;border:none;background:none;
  padding:6px;border-radius:var(--r);color:var(--text-3);
  -webkit-tap-highlight-color:transparent;
}
.tb-ham:hover{background:var(--surface-hover);color:var(--text)}
.tb-ham svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;display:block}
.tb-title{font-size:14px;font-weight:700;color:var(--text);letter-spacing:-.2px}
.tb-spacer{flex:1}
.tb-search{
  display:flex;align-items:center;gap:7px;
  background:var(--bg);border:1px solid var(--border);
  border-radius:var(--r);padding:6px 12px;
  max-width:240px;flex:1;transition:border-color var(--t),background var(--t);
}
.tb-search:focus-within{border-color:var(--brand);background:var(--surface);box-shadow:0 0 0 3px rgba(0,51,153,.08)}
.tb-search svg{width:13px;height:13px;fill:none;stroke:var(--text-4);stroke-width:2;stroke-linecap:round;flex-shrink:0}
.tb-search input{border:none;background:none;outline:none;font-size:13px;color:var(--text);width:100%;font-family:inherit}
.tb-search input::placeholder{color:var(--text-4);font-size:12px}
.tb-actions{display:flex;align-items:center;gap:3px;margin-left:6px}
.tb-btn{
  width:32px;height:32px;border-radius:var(--r);
  border:none;background:none;
  display:flex;align-items:center;justify-content:center;
  color:var(--text-3);position:relative;
  transition:background var(--t),color var(--t);
  -webkit-tap-highlight-color:transparent;
}
.tb-btn:hover{background:var(--surface-hover);color:var(--text)}
.tb-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.tb-badge{
  position:absolute;top:5px;right:5px;
  width:7px;height:7px;border-radius:50%;
  background:var(--danger);border:2px solid var(--surface);display:none;
}
.tb-badge.on{display:block}
.tb-avatar-btn{
  width:30px;height:30px;border-radius:50%;
  background:var(--brand-subtle);color:var(--brand);
  font-size:11px;font-weight:800;border:none;
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;margin-left:2px;
  transition:box-shadow var(--t);
}
.tb-avatar-btn:hover{box-shadow:0 0 0 2px var(--brand)}

/* ── MAIN CONTENT ── */
.shell-main{grid-row:2;grid-column:2;min-width:0;overflow-x:hidden}
.shell-page{padding:24px;max-width:1400px}

/* ── MOBILE BOTTOM NAV ── */
.shell-mobile-nav{
  display:none;position:fixed;bottom:0;left:0;right:0;
  height:60px;background:var(--surface);
  border-top:1px solid var(--border);z-index:500;
  padding-bottom:env(safe-area-inset-bottom,0px);
}
.smn-row{display:flex;height:100%;align-items:stretch}
.smn-item{
  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
  text-decoration:none;color:var(--text-3);border:none;background:none;
  cursor:pointer;font-family:inherit;padding:4px 2px;font-size:9px;font-weight:600;
  -webkit-tap-highlight-color:transparent;transition:color var(--t);position:relative;
}
.smn-item svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.smn-item.active{color:var(--brand)}
.smn-item.active::before{
  content:'';position:absolute;top:0;left:50%;
  transform:translateX(-50%);width:22px;height:2.5px;
  background:var(--brand);border-radius:0 0 3px 3px;
}

/* ── RESPONSIVE ── */
@media(max-width:768px){
  :root{--sidebar-w:0px;--topbar-h:52px}
  .app-shell{grid-template-columns:1fr}
  .shell-sidebar{position:fixed;left:0;top:0;bottom:0;width:248px;transform:translateX(-100%);transition:transform .22s var(--ease);z-index:300}
  .shell-sidebar.open{transform:translateX(0)}
  .shell-topbar{grid-column:1}
  .shell-main{grid-column:1;grid-row:2}
  .shell-page{padding:14px;padding-bottom:76px}
  .tb-ham{display:flex}
  .tb-search{display:none}
  .shell-mobile-nav{display:flex}
}
@media(min-width:769px){
  .shell-sidebar{transform:none!important}
}
@media(max-width:1100px){
  :root{--sidebar-w:210px}
}
</style>`;

  // ── INJECT CSS ────────────────────────────────────────────────
  (function () {
    if (!document.getElementById('shell-css')) {
      var d = document.createElement('div');
      d.innerHTML = CSS;
      var s = d.querySelector('style');
      if (document.head) document.head.appendChild(s);
      else document.write(CSS);
    }
  })();

  // ── RENDER ────────────────────────────────────────────────────
  function render(opts) {
    opts = opts || {};
    var page      = opts.page     || 'dashboard';
    var title     = opts.title    || 'Tableau de bord';
    var isPro     = opts.isPro    || false;
    var plan      = opts.plan     || (isPro ? 'pro' : 'free');
    var userName  = opts.userName || '';
    var userEmail = opts.userEmail|| '';
    var initials  = (userName
      ? userName.split(' ').map(function (w) { return w[0] || ''; }).join('').toUpperCase().slice(0, 2)
      : (userEmail[0] || '?').toUpperCase());
    var patientCount = opts.patientCount || 0;
    var patientLimit = isPro ? Infinity : 30;
    var pct = isPro ? 0 : Math.min(100, Math.round((patientCount / patientLimit) * 100));

    // ── Sidebar nav
    var navHTML = NAV.map(function (n) {
      var cls = 'sb-item' + (n.featured ? ' featured' : '') + (n.key === page ? ' active' : '');
      return '<a href="' + n.href + '" class="' + cls + '" data-key="' + n.key + '">'
        + '<svg viewBox="0 0 24 24">' + n.icon + '</svg>'
        + '<span>' + n.label + '</span>'
        + '</a>';
    }).join('');

    // ── Usage block (free only)
    var usageHTML = !isPro
      ? '<div class="sb-divider"></div>'
        + '<div class="sb-usage">'
        +   '<div class="sb-usage-label"><span>Patients</span><strong>' + patientCount + ' / ' + patientLimit + '</strong></div>'
        +   '<div class="sb-usage-bar"><div class="sb-usage-fill' + (pct > 80 ? ' warn' : '') + (pct >= 100 ? ' danger' : '') + '" style="width:' + pct + '%"></div></div>'
        +   '<a href="pricing.html" class="sb-upgrade">'
        +     '<svg viewBox="0 0 24 24"><polyline points="13 17 18 12 13 7"/><line x1="6" y1="12" x2="18" y2="12"/></svg>'
        +     'Passer en Pro'
        +   '</a>'
        + '</div>'
      : '';

    // ── Sidebar
    var sidebar =
        '<div class="sb-head">'
      +   LOGO
      +   '<span class="sb-wordmark">Prospeo</span>'
      +   '<span class="sb-plan ' + plan + '">' + plan.toUpperCase() + '</span>'
      + '</div>'
      + '<nav class="sb-nav">'
      +   '<div class="sb-section">Clinique</div>'
      +   navHTML
      + '</nav>'
      + usageHTML
      + '<div class="sb-footer">'
      +   '<div class="sb-user" onclick="if(typeof Auth!==\'undefined\')Auth.signOut()" title="Se déconnecter">'
      +     '<div class="sb-avatar">' + initials + '</div>'
      +     '<div class="sb-user-info">'
      +       '<div class="sb-username">' + (userName || userEmail.split('@')[0] || 'Mon compte') + '</div>'
      +       '<div class="sb-email">' + (userEmail || '') + '</div>'
      +     '</div>'
      +     '<button class="sb-signout" title="Se déconnecter">'
      +       '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'
      +     '</button>'
      +   '</div>'
      + '</div>';

    // ── Topbar
    var topbar =
        '<button class="tb-ham" id="tb-ham" aria-label="Menu"><svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>'
      + '<span class="tb-title">' + title + '</span>'
      + '<div class="tb-spacer"></div>'
      + '<div class="tb-search">'
      +   '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
      +   '<input id="shell-search" type="search" placeholder="Rechercher…" autocomplete="off">'
      + '</div>'
      + '<div class="tb-actions">'
      +   '<button class="tb-btn" id="tb-notif" title="Notifications">'
      +     '<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
      +     '<span class="tb-badge" id="notif-badge"></span>'
      +   '</button>'
      +   '<button class="tb-avatar-btn" id="tb-avatar">' + initials + '</button>'
      + '</div>';

    // ── Mobile nav (first 5 items)
    var mobileNav =
        '<nav class="shell-mobile-nav"><div class="smn-row">'
      + NAV.slice(0, 5).map(function (n) {
          return '<a href="' + n.href + '" class="smn-item' + (n.key === page ? ' active' : '') + '">'
            + '<svg viewBox="0 0 24 24">' + n.icon + '</svg>'
            + '<span>' + n.label.split(' ')[0] + '</span>'
            + '</a>';
        }).join('')
      + '</div></nav>';

    return { sidebar: sidebar, topbar: topbar, mobileNav: mobileNav };
  }

  // ── INIT ──────────────────────────────────────────────────────
  function init(opts) {
    var sbEl  = document.getElementById('shell-sidebar');
    var tbEl  = document.getElementById('shell-topbar');
    var ovEl  = document.getElementById('shell-overlay');

    if (!sbEl || !tbEl) {
      console.warn('[Shell] #shell-sidebar ou #shell-topbar introuvable');
      return;
    }

    var html = render(opts);
    sbEl.innerHTML = html.sidebar;
    tbEl.innerHTML = html.topbar;

    // Mobile nav (inject once)
    if (!document.querySelector('.shell-mobile-nav')) {
      var tmp = document.createElement('div');
      tmp.innerHTML = html.mobileNav;
      document.body.appendChild(tmp.firstElementChild);
    }

    // Hamburger
    var ham = document.getElementById('tb-ham');
    var sb  = document.getElementById('shell-sidebar');
    var ov  = document.getElementById('shell-overlay');
    if (ham && sb) {
      ham.addEventListener('click', function () {
        sb.classList.toggle('open');
        if (ov) ov.classList.toggle('open');
      });
    }
    if (ov && sb) {
      ov.addEventListener('click', function () {
        sb.classList.remove('open');
        ov.classList.remove('open');
      });
    }

    // Topbar scroll shadow
    (opts.scrollTarget ? document.querySelector(opts.scrollTarget) : window)
      .addEventListener('scroll', function () {
        var tb = document.getElementById('shell-topbar');
        var y = this === window ? window.scrollY : this.scrollTop;
        if (tb) tb.classList.toggle('scrolled', y > 4);
      }, { passive: true });

    // Search
    var srch = document.getElementById('shell-search');
    if (srch && opts.onSearch) {
      srch.addEventListener('input', function (e) { opts.onSearch(e.target.value.trim()); });
    }
  }

  return { init: init, render: render };
})();
