/**
 * Docline Shell v2 — sidebar + topbar partagés
 * Usage: Shell.init({ page: 'queue', title: 'File d\'attente', isPro, userName, userEmail })
 */
var Shell = (function () {
  'use strict';

  // ── LOGO ──────────────────────────────────────────────────────
  var LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="width:28px;height:28px;flex-shrink:0;border-radius:8px"><defs><linearGradient id="slg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#3B1772"/><stop offset="100%" stop-color="#23A7EA"/></linearGradient></defs><rect width="512" height="512" fill="url(#slg)"/><path fill="white" d="M290.5,38.7c42.2-8.9,87.4,33.7,74.9,76.8c-8.5,40.2-61.9,56.3-94.1,32.9c-21.7-12.9-34.3-40.4-28.9-65.3C247.4,60.5,267.4,41.6,290.5,38.7z M294.6,70c-24.1,4.7-28.1,40.2-7.1,51.6c15.1,11.3,39.9,6.1,46-12.7C342.5,86.3,316.5,63.5,294.6,70z"/><path fill="white" d="M132.9,103.8c25-4.1,51.6-1.1,72.7,13.6c28.8,19.6,46.3,51.6,57.4,84c37.8-16.9,77.9-32.3,119.9-30.6c33.9,1.6,64.8,24.5,76.5,56.1c9.8,39.1-9,77.8-31.4,108.8C386.7,393,324.7,441.1,252.5,448c-23.2,21.2-58.8,33.5-88.9,20.2c-36.5-16.8-59.2-51.9-77.6-86.1c-28.8-59.4-43.6-127.1-33.3-192.9C60.5,148.6,89.8,109.4,132.9,103.8z M141.3,137.4c-34.9,4.9-54,42.3-55.4,74.6c-2.2,65.6,15.8,132.4,52.6,186.9c14.6,21.9,38.2,47,67.1,37.5c-2-8.7-14.6-10.7-19.5-17.9c-24.9-25.2-41-61.6-35.4-97.3c1-24.6,18.4-47.7,42.1-54.8c29.6-11,67,1.4,82,29.8c20.5,33.5,15.1,75.5,4.3,111.3c30.1-8.1,55.2-27.9,79.2-46.9c28.7-27.6,56.7-60,66.5-99.5c8.2-25.4-13.1-50.5-37.4-54.4c-51.9-9.3-94.3,25.2-140.6,40.3c-20.9,4.6-39.4-16.8-36.9-36.6c5.2-3.5,11.1-0.3,16.8-0.4C217.3,172.5,185,128.2,141.3,137.4z M206.4,298.9c-13.3,3.7-20.9,17.4-19.7,30.8c-3.1,32.5,18.1,68.3,49.9,77.4c19.2-27.9,21.2-68.2,4.3-98C231.8,300.1,219,295.3,206.4,298.9z"/></svg>';

  // ── NAV ───────────────────────────────────────────────────────
  var NAV = [
    // ── Section: Clinique
    { section: 'Clinique' },
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
    // ── Section: Rendez-vous en ligne
    { section: 'Rendez-vous' },
    { href:'mes-rdv.html',       key:'mes-rdv',      label:'Mes Rendez-vous',
      icon:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="m9 16 2 2 4-4"/>' },
    { href:'disponibilites.html',key:'disponibilites',label:'Mes disponibilités',
      icon:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    { href:'profil-public.html', key:'profil-public',label:'Profil public',
      icon:'<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="9" cy="10" r="2.5"/><path d="M14 10h4m-4 3.5h4M5 18c0-1.7 1.8-2.5 4-2.5s4 .8 4 2.5"/>' },
  ];

  // ── CSS ───────────────────────────────────────────────────────
  var CSS = `<style id="shell-css">
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --brand:#3B1772;
  --brand-hover:#2D1259;
  --brand-subtle:#EDE8FF;
  --brand-border:rgba(59,23,114,.15);

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
.sb-plan.enterprise{background:rgba(59,23,114,.1);color:var(--brand)}

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
.sb-item.featured:hover{background:rgba(59,23,114,.12)}
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
.tb-search:focus-within{border-color:var(--brand);background:var(--surface);box-shadow:0 0 0 3px rgba(59,23,114,.08)}
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
      if (n.section) return '<div class="sb-section">' + n.section + '</div>';
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
      +   '<span class="sb-wordmark">Docline</span>'
      +   '<span class="sb-plan ' + plan + '">' + plan.toUpperCase() + '</span>'
      + '</div>'
      + '<nav class="sb-nav">'
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

    // ── Mobile nav (first 5 real nav items, skip section headers)
    var mobileNavItems = NAV.filter(function(n){ return !n.section; }).slice(0, 5);
    var mobileNav =
        '<nav class="shell-mobile-nav"><div class="smn-row">'
      + mobileNavItems.map(function (n) {
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
