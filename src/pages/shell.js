/**
 * Docline Shell v2 — sidebar + topbar partagés
 * Usage: Shell.init({ page: 'queue', title: 'File d\'attente', isPro, userName, userEmail })
 */

// Global error capture — envoyé à Sentry si initialisé
window.addEventListener('error', function (e) {
  if (typeof Sentry !== 'undefined') {
    Sentry.captureException(e.error || new Error(e.message), {
      extra: { filename: e.filename, lineno: e.lineno, colno: e.colno },
    });
  }
});
window.addEventListener('unhandledrejection', function (e) {
  if (typeof Sentry !== 'undefined') {
    Sentry.captureException(e.reason instanceof Error ? e.reason : new Error(String(e.reason)));
  }
});

var Shell = (function () {
  'use strict';

  // ── LOGO ──────────────────────────────────────────────────────
  var LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="width:28px;height:28px;flex-shrink:0;border-radius:8px"><defs><linearGradient id="slg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#3B1772"/><stop offset="100%" stop-color="#23A7EA"/></linearGradient></defs><rect width="512" height="512" fill="url(#slg)"/><path fill="white" d="M290.5,38.7c42.2-8.9,87.4,33.7,74.9,76.8c-8.5,40.2-61.9,56.3-94.1,32.9c-21.7-12.9-34.3-40.4-28.9-65.3C247.4,60.5,267.4,41.6,290.5,38.7z M294.6,70c-24.1,4.7-28.1,40.2-7.1,51.6c15.1,11.3,39.9,6.1,46-12.7C342.5,86.3,316.5,63.5,294.6,70z"/><path fill="white" d="M132.9,103.8c25-4.1,51.6-1.1,72.7,13.6c28.8,19.6,46.3,51.6,57.4,84c37.8-16.9,77.9-32.3,119.9-30.6c33.9,1.6,64.8,24.5,76.5,56.1c9.8,39.1-9,77.8-31.4,108.8C386.7,393,324.7,441.1,252.5,448c-23.2,21.2-58.8,33.5-88.9,20.2c-36.5-16.8-59.2-51.9-77.6-86.1c-28.8-59.4-43.6-127.1-33.3-192.9C60.5,148.6,89.8,109.4,132.9,103.8z M141.3,137.4c-34.9,4.9-54,42.3-55.4,74.6c-2.2,65.6,15.8,132.4,52.6,186.9c14.6,21.9,38.2,47,67.1,37.5c-2-8.7-14.6-10.7-19.5-17.9c-24.9-25.2-41-61.6-35.4-97.3c1-24.6,18.4-47.7,42.1-54.8c29.6-11,67,1.4,82,29.8c20.5,33.5,15.1,75.5,4.3,111.3c30.1-8.1,55.2-27.9,79.2-46.9c28.7-27.6,56.7-60,66.5-99.5c8.2-25.4-13.1-50.5-37.4-54.4c-51.9-9.3-94.3,25.2-140.6,40.3c-20.9,4.6-39.4-16.8-36.9-36.6c5.2-3.5,11.1-0.3,16.8-0.4C217.3,172.5,185,128.2,141.3,137.4z M206.4,298.9c-13.3,3.7-20.9,17.4-19.7,30.8c-3.1,32.5,18.1,68.3,49.9,77.4c19.2-27.9,21.2-68.2,4.3-98C231.8,300.1,219,295.3,206.4,298.9z"/></svg>';

  // ── NAV ───────────────────────────────────────────────────────
  var NAV = [
    // ── Vue d'ensemble
    { section: 'Vue d\'ensemble' },
    { href:'/dashboard',          key:'dashboard',      label:'Tableau de bord',
      icon:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>' },

    // ── Activité du jour
    { section: 'Activité du jour' },
    { href:'queue.html',          key:'queue',          label:"File d'attente", featured:true, pro:true,
      icon:'<path d="M9 12h.01M12 12h.01M15 12h.01M12 8c-4.418 0-8 1.79-8 4s3.582 4 8 4 8-1.79 8-4-3.582-4-8-4z"/><path d="M4 12v4c0 2.21 3.582 4 8 4s8-1.79 8-4v-4"/>' },
    { href:'/calendar',           key:'calendar',       label:'Agenda',
      icon:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    { href:'consultations.html',  key:'consultations',  label:'Consultations',
      icon:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' },

    // ── Dossiers médicaux
    { section: 'Dossiers médicaux' },
    { href:'/patients',           key:'clients',        label:'Patients',
      icon:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { href:'ordonnances.html',    key:'ordonnances',    label:'Ordonnances',
      icon:'<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/>' },
    { href:'labo.html',           key:'labo',           label:'Laboratoire',  pro:true,
      icon:'<path d="M6 2v6l-2 4v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8l-2-4V2"/><line x1="6" y1="10" x2="14" y2="10"/>' },

    // ── Prise de rendez-vous
    { section: 'Rendez-vous en ligne' },
    { href:'/mes-rdv',            key:'mes-rdv',        label:'Mes Rendez-vous',
      icon:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="m9 16 2 2 4-4"/>' },
    { href:'disponibilites.html', key:'disponibilites', label:'Disponibilités',
      icon:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    { href:'profil-public.html',  key:'profil-public',  label:'Profil public',
      icon:'<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="9" cy="10" r="2.5"/><path d="M14 10h4m-4 3.5h4M5 18c0-1.7 1.8-2.5 4-2.5s4 .8 4 2.5"/>' },

    // ── Mon équipe
    { section: 'Mon équipe' },
    { href:'staff.html',          key:'staff',          label:'Personnel',    pro:true,
      icon:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="23" y2="8"/><line x1="21" y1="6" x2="21" y2="10"/>' },
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
.shell-page{padding:24px;max-width:1200px;margin:0 auto;width:100%;box-sizing:border-box}
.page{padding:24px;max-width:1200px;margin:0 auto;width:100%;box-sizing:border-box}

/* ── MOBILE BOTTOM NAV — désactivée ── */
.shell-mobile-nav{display:none!important}

/* ── RESPONSIVE ── */
@media(max-width:768px){
  :root{--sidebar-w:0px;--topbar-h:52px}
  .app-shell{grid-template-columns:1fr}
  .shell-sidebar{position:fixed;left:0;top:0;bottom:0;width:248px;transform:translateX(-100%);transition:transform .22s var(--ease);z-index:300}
  .shell-sidebar.open{transform:translateX(0)}
  .shell-topbar{grid-column:1}
  .shell-main{grid-column:1;grid-row:2}
  .shell-page{padding:14px}
  .tb-ham{display:flex}
  .tb-search{display:none}
}
@media(min-width:769px){
  /* Auto-hide sidebar: smooth slide + grid collapse */
  .shell-sidebar{transition:transform .32s cubic-bezier(.4,0,.2,1)}
  .app-shell{transition:grid-template-columns .32s cubic-bezier(.4,0,.2,1)}
  .app-shell.sb-hidden{grid-template-columns:0 1fr}
  .app-shell.sb-hidden .shell-sidebar{transform:translateX(-100%)}
  /* Thin left-edge trigger zone shown when sidebar is hidden */
  .sb-edge-trigger{
    position:fixed;top:0;left:0;bottom:0;width:16px;
    z-index:201;cursor:w-resize;display:none;
  }
  .app-shell.sb-hidden~.sb-edge-trigger,
  body.sb-hidden-body .sb-edge-trigger{display:block}
}
@media(max-width:1100px){
  :root{--sidebar-w:210px}
}

/* ═══════════════════════════════════════════════════════════
   DOCLINE DESIGN SYSTEM — composants partagés toutes pages
═══════════════════════════════════════════════════════════ */

/* ── Page header ── */
.page-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:14px}
.page-title{font-size:24px;font-weight:900;color:var(--text);letter-spacing:-.6px;display:flex;align-items:center;gap:10px;line-height:1.1}
.page-title svg{width:22px;height:22px;flex-shrink:0;fill:none;stroke:var(--brand);stroke-width:2;stroke-linecap:round}
.page-sub{font-size:13px;color:var(--text-3);margin-top:5px;line-height:1.5;font-weight:400}
.page-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}

/* ── Unified stat cards — unifie .kpi, .kpi-card, .kpi-pill, .stat-card ── */
.kpi-row,.stats-row,.kpi-strip{display:grid;gap:14px;margin-bottom:24px}
.kpi-row{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.stats-row{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.kpi-strip{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}

.kpi-card,.kpi,.kpi-pill,.stat-card{
  background:var(--surface);border:1.5px solid var(--border);
  border-radius:18px;padding:20px 20px 16px;
  position:relative;overflow:hidden;
  transition:transform .18s var(--ease),box-shadow .18s var(--ease);
  cursor:default;
}
.kpi-card:hover,.kpi:hover,.kpi-pill:hover,.stat-card:hover{
  transform:translateY(-3px);
  box-shadow:0 8px 24px rgba(0,0,0,.08);
}

/* Icon inside stat cards */
.kpi-ico,.stat-icon{
  width:40px;height:40px;border-radius:12px;
  display:flex;align-items:center;justify-content:center;
  margin-bottom:12px;flex-shrink:0;
}
.kpi-ico svg,.stat-icon svg{width:19px;height:19px;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}

/* Values */
.kpi-val,.stat-num{font-size:30px;font-weight:900;line-height:1;margin-bottom:3px;font-variant-numeric:tabular-nums;transition:all .4s cubic-bezier(.34,1.56,.64,1)}
.kpi-lbl,.stat-lbl{font-size:11.5px;font-weight:600;color:var(--text-3);letter-spacing:.03em}

/* Color variants — badge en haut à droite */
.stat-badge,.kpi-badge{position:absolute;top:14px;right:14px;font-size:10px;font-weight:700;padding:3px 9px;border-radius:99px;letter-spacing:.04em}

/* Blue */
.kpi-card.blue .kpi-ico,.stat-card.blue .stat-icon{background:#EFF6FF}
.kpi-card.blue .kpi-ico svg,.stat-card.blue .stat-icon svg{stroke:#2563EB}
.kpi-card.blue .kpi-val,.stat-card.blue .stat-num{color:#1D4ED8}
.kpi-card.blue .stat-badge,.kpi-card.blue .kpi-badge{background:#EFF6FF;color:#2563EB}
/* Violet (brand) */
.kpi-card.violet .kpi-ico,.stat-card.violet .stat-icon{background:#EDE8FF}
.kpi-card.violet .kpi-ico svg,.stat-card.violet .stat-icon svg{stroke:var(--brand)}
.kpi-card.violet .kpi-val,.stat-card.violet .stat-num{color:var(--brand)}
/* Green */
.kpi-card.green .kpi-ico,.stat-card.green .stat-icon{background:#ECFDF5}
.kpi-card.green .kpi-ico svg,.stat-card.green .stat-icon svg{stroke:#059669}
.kpi-card.green .kpi-val,.stat-card.green .stat-num{color:#059669}
.kpi-card.green .stat-badge,.kpi-card.green .kpi-badge{background:#ECFDF5;color:#059669}
/* Amber */
.kpi-card.amber .kpi-ico,.stat-card.amber .stat-icon{background:#FFFBEB}
.kpi-card.amber .kpi-ico svg,.stat-card.amber .stat-icon svg{stroke:#D97706}
.kpi-card.amber .kpi-val,.stat-card.amber .stat-num{color:#D97706}
.kpi-card.amber .stat-badge,.kpi-card.amber .kpi-badge{background:#FFFBEB;color:#D97706}
/* Red */
.kpi-card.red .kpi-ico,.stat-card.red .stat-icon{background:#FEF2F2}
.kpi-card.red .kpi-ico svg,.stat-card.red .stat-icon svg{stroke:#DC2626}
.kpi-card.red .kpi-val,.stat-card.red .stat-num{color:#DC2626}
.kpi-card.red .stat-badge,.kpi-card.red .kpi-badge{background:#FEF2F2;color:#DC2626}

/* kpi-pill color variants (/patients) */
.kpi-pill.blue .kpi-ico{background:#EFF6FF}.kpi-pill.blue .kpi-ico svg{stroke:#2563EB}.kpi-pill.blue .kpi-val{color:#1D4ED8}
.kpi-pill.violet .kpi-ico{background:#EDE8FF}.kpi-pill.violet .kpi-ico svg{stroke:var(--brand)}.kpi-pill.violet .kpi-val{color:var(--brand)}
.kpi-pill.green .kpi-ico{background:#ECFDF5}.kpi-pill.green .kpi-ico svg{stroke:#059669}.kpi-pill.green .kpi-val{color:#059669}
.kpi-pill.amber .kpi-ico{background:#FFFBEB}.kpi-pill.amber .kpi-ico svg{stroke:#D97706}.kpi-pill.amber .kpi-val{color:#D97706}
.kpi-pill.red .kpi-ico{background:#FEF2F2}.kpi-pill.red .kpi-ico svg{stroke:#DC2626}.kpi-pill.red .kpi-val{color:#DC2626}

/* ── Panel card (content sections) ── */
.panel-card,.card-section{background:var(--surface);border:1.5px solid var(--border);border-radius:18px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.03)}
.panel-card-head,.card-head{padding:16px 20px;border-bottom:1.5px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px}
.panel-card-title,.card-title{font-size:14px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px;letter-spacing:-.2px}
.panel-card-title svg,.card-title svg{width:16px;height:16px;fill:none;stroke:var(--brand);stroke-width:2;stroke-linecap:round;flex-shrink:0}
.panel-card-body,.card-body{padding:20px}

/* ── Unified buttons ── */
.btn-primary{display:inline-flex;align-items:center;gap:7px;padding:10px 20px;background:var(--brand);color:#fff;border:none;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .18s var(--ease);box-shadow:0 3px 14px rgba(59,23,114,.22);white-space:nowrap}
.btn-primary:hover:not(:disabled){background:#4C1D95;transform:translateY(-1px);box-shadow:0 6px 20px rgba(59,23,114,.32)}
.btn-primary:active{transform:scale(.98)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
.btn-primary svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round}

.btn-secondary{display:inline-flex;align-items:center;gap:7px;padding:9px 18px;background:var(--surface);color:var(--text-2);border:1.5px solid var(--border);border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
.btn-secondary:hover{border-color:var(--brand);color:var(--brand);background:var(--brand-subtle)}
.btn-secondary svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}

.btn-ghost{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:none;color:var(--text-3);border:none;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
.btn-ghost:hover{background:var(--surface-hover);color:var(--text)}

/* ── Badge / tag ── */
.badge,.tag{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.03em;flex-shrink:0}
.badge-violet,.tag-violet{background:#EDE8FF;color:var(--brand)}
.badge-green,.tag-green{background:#ECFDF5;color:#059669}
.badge-amber,.tag-amber{background:#FFFBEB;color:#D97706}
.badge-red,.tag-red{background:#FEF2F2;color:#DC2626}
.badge-blue,.tag-blue{background:#EFF6FF;color:#2563EB}
.badge-gray,.tag-gray{background:var(--surface-hover);color:var(--text-3)}

/* ── Empty state ── */
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 24px;text-align:center;gap:0}
.empty-state-icon{width:64px;height:64px;background:var(--surface-hover);border-radius:20px;display:flex;align-items:center;justify-content:center;margin-bottom:18px}
.empty-state-icon svg{width:30px;height:30px;fill:none;stroke:var(--text-3);stroke-width:1.5;stroke-linecap:round;opacity:.7}
.empty-state-title{font-size:16px;font-weight:700;color:var(--text-2);margin-bottom:6px;letter-spacing:-.2px}
.empty-state-sub{font-size:13px;color:var(--text-3);line-height:1.6;max-width:340px;margin-bottom:20px}

/* ── Search bar ── */
.search-bar{position:relative;display:flex;align-items:center}
.search-bar svg{position:absolute;left:12px;width:15px;height:15px;fill:none;stroke:var(--text-3);stroke-width:2;stroke-linecap:round;pointer-events:none}
.search-bar input{height:40px;border:1.5px solid var(--border);border-radius:12px;padding:0 14px 0 38px;font-size:13px;color:var(--text);font-family:inherit;background:var(--surface);outline:none;transition:border-color .15s,box-shadow .15s;min-width:220px}
.search-bar input:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(59,23,114,.08)}
.search-bar input::placeholder{color:var(--text-3)}

/* ── Filter chips ── */
.filter-chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{padding:6px 14px;border-radius:99px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:var(--surface);color:var(--text-3);font-family:inherit;transition:all .15s;white-space:nowrap}
.chip:hover{border-color:var(--brand);color:var(--brand)}
.chip.active{background:var(--brand);color:#fff;border-color:var(--brand)}

/* ── Toolbar ── */
.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px}

/* ── Form inputs ── */
.fi-group{margin-bottom:14px}
.fi-label{display:block;font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:6px}
.fi-input{width:100%;height:44px;border:1.5px solid var(--border);border-radius:12px;padding:0 14px;font-size:14px;color:var(--text);font-family:inherit;background:var(--surface);outline:none;transition:border-color .15s,box-shadow .15s}
.fi-input:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(59,23,114,.08)}
.fi-input::placeholder{color:var(--text-3)}
.fi-textarea{width:100%;border:1.5px solid var(--border);border-radius:12px;padding:11px 14px;font-size:14px;color:var(--text);font-family:inherit;background:var(--surface);outline:none;resize:vertical;transition:border-color .15s,box-shadow .15s;line-height:1.5}
.fi-textarea:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(59,23,114,.08)}

/* ── Divider ── */
.section-divider{height:1px;background:var(--border);margin:24px 0}

/* ── Loading skeleton ── */
.skeleton{background:linear-gradient(90deg,var(--border) 25%,var(--surface-hover) 50%,var(--border) 75%);background-size:200% 100%;animation:shimmer 1.4s ease-in-out infinite;border-radius:8px}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* ── Profile popover ── */
.sb-pop-wrap{position:relative}
.sb-profile-pop{
  position:absolute;bottom:calc(100% + 8px);left:0;right:0;
  background:var(--surface);border:1.5px solid var(--border);
  border-radius:16px;z-index:500;overflow:hidden;
  box-shadow:0 -4px 24px rgba(0,0,0,.1),0 12px 40px rgba(0,0,0,.12);
  animation:popUp .17s cubic-bezier(.34,1.56,.64,1) both;
  transform-origin:bottom center;
}
@keyframes popUp{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}
.sb-pop-head{
  padding:14px 14px 12px;display:flex;align-items:center;gap:11px;
  background:var(--brand-subtle);border-bottom:1px solid var(--border);
}
.sb-pop-big-av{
  width:42px;height:42px;border-radius:12px;flex-shrink:0;
  background:var(--brand);color:#fff;
  font-size:13px;font-weight:800;letter-spacing:.4px;
  display:flex;align-items:center;justify-content:center;
}
.sb-pop-info{min-width:0;flex:1}
.sb-pop-name{font-size:13px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-pop-mail{font-size:10.5px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
.sb-pop-badge{
  font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;
  margin-top:5px;display:inline-block;letter-spacing:.06em;
}
.sb-pop-badge.pro{background:rgba(5,150,105,.12);color:#059669}
.sb-pop-badge.free{background:var(--surface-hover);color:var(--text-3)}
.sb-pop-menu{padding:6px}
.sb-pop-item{
  display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;
  font-size:13px;font-weight:500;color:var(--text-2);
  cursor:pointer;border:none;background:none;width:100%;
  text-align:left;font-family:inherit;text-decoration:none;
  transition:background .1s,color .1s;
}
.sb-pop-item:hover{background:var(--surface-hover);color:var(--text)}
.sb-pop-item svg{
  width:15px;height:15px;fill:none;stroke:currentColor;
  stroke-width:2;stroke-linecap:round;stroke-linejoin:round;
  flex-shrink:0;opacity:.6;transition:opacity .1s;
}
.sb-pop-item:hover svg{opacity:1}
.sb-pop-sep{height:1px;background:var(--border);margin:4px 8px}
.sb-pop-item.danger{color:var(--danger)}
.sb-pop-item.danger:hover{background:var(--danger-bg)}
.sb-pop-item.danger svg{opacity:1}
/* chevron indicator on user row */
.sb-chevron{width:18px;height:18px;fill:none;stroke:var(--text-4);stroke-width:2;stroke-linecap:round;transition:transform .2s,stroke .2s;flex-shrink:0}
.sb-footer.pop-open .sb-chevron{transform:rotate(180deg);stroke:var(--brand)}

/* ── Sidebar peek arrow ──────────────────────────────────────── */
.sb-peek{
  position:fixed;left:0;top:50%;
  transform:translateY(-50%) translateX(-100%);
  z-index:300;width:22px;height:64px;
  background:var(--brand);border-radius:0 12px 12px 0;
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;
  box-shadow:3px 0 16px rgba(59,23,114,.28);
  opacity:0;
  transition:transform .35s cubic-bezier(.34,1.56,.64,1),opacity .3s;
  pointer-events:none;
}
.sb-peek.on{
  transform:translateY(-50%) translateX(0);
  opacity:1;pointer-events:auto;
}
.sb-peek:hover{background:var(--brand-hover);width:28px}
.sb-peek svg{
  width:13px;height:13px;fill:none;
  stroke:#fff;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;
  animation:peek-nudge 1.1s ease-in-out infinite alternate;
}
@keyframes peek-nudge{
  from{transform:translateX(-1px)}
  to{transform:translateX(3px)}
}
/* Mobile : flèche en bas à gauche, au-dessus de la bottom-nav */
@media(max-width:768px){
  .sb-peek{
    left:16px;top:auto;bottom:20px;
    width:46px;height:46px;border-radius:50%;
    /* remplace le slide depuis la gauche par un pop depuis le bas */
    transform:translateY(80px) scale(.8);
    box-shadow:0 4px 20px rgba(59,23,114,.35);
  }
  .sb-peek.on{transform:translateY(0) scale(1)}
  .sb-peek:hover{width:46px} /* pas d'élargissement sur mobile */
}

/* ── ONBOARDING ─────────────────────────────────────────────── */
#ob-ov{position:fixed;inset:0;background:rgba(15,10,40,.75);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(10px);animation:ob-bg .4s ease both}
@keyframes ob-bg{from{opacity:0}to{opacity:1}}
#ob-modal{background:#fff;border-radius:24px;width:100%;max-width:480px;box-shadow:0 32px 80px rgba(0,0,0,.30);overflow:hidden;animation:ob-pop .45s cubic-bezier(.34,1.56,.64,1) both}
@keyframes ob-pop{from{opacity:0;transform:scale(.85) translateY(20px)}to{opacity:1;transform:none}}
.ob-bar{height:4px;background:#EDE8FF}
.ob-fill{height:100%;background:linear-gradient(90deg,#3B1772,#7C3AED);border-radius:99px;transition:width .45s cubic-bezier(.4,0,.2,1)}
.ob-body{padding:32px 32px 20px;min-height:300px}
.ob-illo{height:150px;display:flex;align-items:center;justify-content:center;margin-bottom:22px;position:relative}
.ob-illo-inner{animation:ob-zoom .5s cubic-bezier(.34,1.56,.64,1) both .1s}
@keyframes ob-zoom{from{opacity:0;transform:scale(.65) translateY(14px)}to{opacity:1;transform:scale(1) translateY(0)}}
.ob-chip{display:inline-block;font-size:10px;font-weight:700;color:#7C3AED;background:#EDE8FF;border-radius:99px;padding:3px 10px;letter-spacing:.07em;text-transform:uppercase;margin-bottom:10px}
.ob-title{font-size:21px;font-weight:900;color:#0C0E14;letter-spacing:-.4px;line-height:1.25;margin-bottom:10px}
.ob-desc{font-size:13.5px;color:#7B8194;line-height:1.7;margin-bottom:10px}
.ob-access-link{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:#3B1772;text-decoration:none;padding:5px 12px;border-radius:99px;border:1.5px solid rgba(59,23,114,.2);background:rgba(59,23,114,.04);transition:.15s;margin-top:2px}
.ob-access-link:hover{background:rgba(59,23,114,.09);border-color:rgba(59,23,114,.4)}
.ob-access-link svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round;flex-shrink:0}
.ob-foot{padding:18px 32px 26px;display:flex;align-items:center;gap:12px}
.ob-dots{display:flex;gap:6px;flex:1}
.ob-dot{width:8px;height:8px;border-radius:4px;background:#E8EAF0;transition:all .3s cubic-bezier(.4,0,.2,1)}
.ob-dot.on{width:22px;background:#3B1772}
.ob-skip{font-size:12px;font-weight:500;color:#B0B7CC;background:none;border:none;cursor:pointer;padding:4px 6px;font-family:inherit;transition:color .15s}
.ob-skip:hover{color:#7B8194}
.ob-btn{padding:11px 22px;border-radius:99px;font-size:13.5px;font-weight:700;cursor:pointer;border:none;background:linear-gradient(135deg,#3B1772 0%,#6D28D9 100%);color:#fff;font-family:inherit;box-shadow:0 4px 16px rgba(59,23,114,.35);display:flex;align-items:center;gap:7px;transition:all .18s}
.ob-btn:hover{transform:translateY(-1px);box-shadow:0 6px 22px rgba(59,23,114,.45)}
.ob-btn:active{transform:scale(.97)}
.ob-btn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round;transition:transform .2s}
.ob-btn:hover svg{transform:translateX(3px)}
@media(max-width:480px){
  .ob-body{padding:22px 18px 14px}
  .ob-foot{padding:14px 18px 22px}
  .ob-illo{height:110px}
  .ob-title{font-size:18px}
}

/* ── LOCKED NAV ITEM ── */
.sb-item.locked-clickable{opacity:.45;cursor:not-allowed}
.sb-item.locked-clickable:hover{background:none!important;color:var(--text-2)!important}
.sb-item.locked-clickable svg.sb-lock-ico{display:block!important}
.sb-lock-ico{display:none;width:11px;height:11px;margin-left:auto;fill:none;stroke:var(--text-3);stroke-width:2.2;flex-shrink:0;stroke-linecap:round}

/* ── NO-ACCESS OVERLAY ── */
.shell-no-access{position:fixed;inset:0;background:var(--bg);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;animation:sna-in .25s ease}
@keyframes sna-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.shell-no-access-ico{width:72px;height:72px;border-radius:20px;background:#FEF2F2;display:flex;align-items:center;justify-content:center;margin-bottom:20px}
.shell-no-access-ico svg{width:32px;height:32px;fill:none;stroke:#DC2626;stroke-width:1.8;stroke-linecap:round}
.shell-no-access-title{font-size:22px;font-weight:900;color:var(--text);letter-spacing:-.4px;margin-bottom:8px}
.shell-no-access-sub{font-size:14px;color:var(--text-3);line-height:1.6;max-width:380px}
.shell-no-access-back{margin-top:24px;display:inline-flex;align-items:center;gap:7px;padding:10px 22px;background:var(--brand);color:#fff;border:none;border-radius:99px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;transition:background .15s}
.shell-no-access-back:hover{background:var(--brand-hover)}

/* ── TOAST ACCES REFUSE ── */
.shell-toast-na{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1E293B;color:#fff;padding:11px 22px;border-radius:99px;font-size:13px;font-weight:600;z-index:10000;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.2);transition:opacity .3s;pointer-events:none}

/* ── RDV pending badge (sidebar) ── */
.sb-lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-rdv-dot{
  margin-left:auto;flex-shrink:0;
  min-width:20px;height:20px;padding:0 6px;
  border-radius:99px;
  background:#DC2626;color:#fff;
  font-size:10px;font-weight:800;letter-spacing:.01em;
  display:inline-flex;align-items:center;justify-content:center;
  animation:rdv-pulse 1.8s ease-in-out infinite;
  line-height:1;
}
@keyframes rdv-pulse{
  0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.6);transform:scale(1)}
  50%  {box-shadow:0 0 0 6px rgba(220,38,38,.0);transform:scale(1.08)}
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
      var isLocked = n.pro && !isPro;
      var cls = 'sb-item' + (n.featured ? ' featured' : '') + (n.key === page ? ' active' : '') + (isLocked ? ' locked-clickable' : '');
      var rdvBadge = n.key === 'mes-rdv'
        ? '<span class="sb-rdv-dot" id="sb-rdv-dot" style="display:none"></span>'
        : '';
      if (isLocked) {
        return '<a href="' + ghpNav('/pricing') + '" class="' + cls + '" data-key="' + n.key + '" title="Fonctionnalité Pro — Mettre à niveau">'
          + '<svg viewBox="0 0 24 24">' + n.icon + '</svg>'
          + '<span class="sb-lbl">' + n.label + '</span>'
          + '<svg class="sb-lock-ico" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
          + '</a>';
      }
      return '<a href="' + n.href + '" class="' + cls + '" data-key="' + n.key + '">'
        + '<svg viewBox="0 0 24 24">' + n.icon + '</svg>'
        + '<span class="sb-lbl">' + n.label + '</span>'
        + rdvBadge
        + '</a>';
    }).join('');

    // ── Usage block (free only)
    var usageHTML = !isPro
      ? '<div class="sb-divider"></div>'
        + '<div class="sb-usage">'
        +   '<div class="sb-usage-label"><span>Patients</span><strong>' + patientCount + ' / ' + patientLimit + '</strong></div>'
        +   '<div class="sb-usage-bar"><div class="sb-usage-fill' + (pct > 80 ? ' warn' : '') + (pct >= 100 ? ' danger' : '') + '" style="width:' + pct + '%"></div></div>'
        +   '<a href="/pricing" class="sb-upgrade">'
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
      + '<div class="sb-footer" id="sb-footer">'
      +   '<div class="sb-pop-wrap" id="sb-pop-wrap">'
      +   '<div class="sb-user" id="sb-user-btn" title="Mon profil">'
      +     '<div class="sb-avatar">' + initials + '</div>'
      +     '<div class="sb-user-info">'
      +       '<div class="sb-username">' + (userName || userEmail.split('@')[0] || 'Mon compte') + '</div>'
      +       '<div class="sb-email">' + (userEmail || '') + '</div>'
      +     '</div>'
      +     '<svg class="sb-chevron" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>'
      +   '</div>'
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

  // ── PROFILE POPOVER ───────────────────────────────────────────
  function _buildProfilePop(o) {
    var planCls = (o.plan === 'pro' || o.plan === 'clinic') ? 'pro' : 'free';
    var planLbl = o.plan === 'clinic' ? 'CLINIC' : o.plan === 'pro' ? 'PRO' : 'FREE';
    function esc(s){ var d=document.createElement('div');d.textContent=String(s||'');return d.innerHTML; }
    return '<div class="sb-profile-pop" id="sb-profile-pop">'
      /* ── Header ── */
      + '<div class="sb-pop-head">'
      +   '<div class="sb-pop-big-av">' + esc(o.initials) + '</div>'
      +   '<div class="sb-pop-info">'
      +     '<div class="sb-pop-name">' + esc(o.userName || o.userEmail.split('@')[0]) + '</div>'
      +     '<div class="sb-pop-mail">' + esc(o.userEmail) + '</div>'
      +     '<span class="sb-pop-badge ' + planCls + '">' + planLbl + '</span>'
      +   '</div>'
      + '</div>'
      /* ── Menu ── */
      + '<div class="sb-pop-menu">'
      /* Mon profil public */
      +   '<a href="/profil-public" class="sb-pop-item">'
      +     '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="9" cy="10" r="2.5"/><path d="M14 10h4m-4 3.5h4M5 18c0-1.7 1.8-2.5 4-2.5s4 .8 4 2.5"/></svg>'
      +     'Mon profil public'
      +   '</a>'
      /* Modifier le logo */
      +   '<a href="profil-public.html#logo" class="sb-pop-item" id="sb-pop-logo">'
      +     '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/></svg>'
      +     'Modifier le logo / avatar'
      +   '</a>'
      /* Mes disponibilités */
      +   '<a href="/disponibilites" class="sb-pop-item">'
      +     '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
      +     'Mes disponibilités'
      +   '</a>'
      +   '<div class="sb-pop-sep"></div>'
      /* Contacter le support */
      +   '<a href="mailto:support@docline.dz" class="sb-pop-item">'
      +     '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
      +     'Contacter le support'
      +   '</a>'
      +   '<div class="sb-pop-sep"></div>'
      /* Déconnexion */
      +   '<button class="sb-pop-item danger" id="sb-pop-signout">'
      +     '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'
      +     'Se déconnecter'
      +   '</button>'
      + '</div>'
      + '</div>';
  }

  // ── RDV BADGE ─────────────────────────────────────────────────
  var _rdvClient = null;

  function _setRdvBadge(n) {
    var dot = document.getElementById('sb-rdv-dot');
    if (dot) {
      if (n > 0) {
        dot.textContent = n > 99 ? '99+' : String(n);
        dot.style.display = 'inline-flex';
      } else {
        dot.style.display = 'none';
      }
    }
    // Allume aussi le badge cloche dans la topbar
    var bell = document.getElementById('notif-badge');
    if (bell) bell.classList.toggle('on', n > 0);
  }

  function _watchRdv() {
    try {
      if (typeof supabase === 'undefined') return;
      var url = typeof SUPA_URL !== 'undefined'          ? SUPA_URL
              : typeof DOCLINE_CONFIG !== 'undefined'    ? DOCLINE_CONFIG.SUPA_URL
              : null;
      var key = typeof SUPA_KEY !== 'undefined'          ? SUPA_KEY
              : typeof DOCLINE_CONFIG !== 'undefined'    ? DOCLINE_CONFIG.SUPA_KEY
              : null;
      if (!url || !key) return;
      if (!_rdvClient) _rdvClient = supabase.createClient(url, key);

      _rdvClient.auth.getSession().then(function (res) {
        var sess = res && res.data && res.data.session;
        if (!sess) return;
        var uid = sess.user.id;

        function refresh() {
          _rdvClient
            .from('appointments')
            .select('id', { count: 'exact', head: true })
            .eq('doctor_id', uid)
            .eq('status', 'pending')
            .then(function (r) { _setRdvBadge(r.count || 0); });
        }

        // Premier appel immédiat
        refresh();

        // Son Apple-like (Web Audio API)
        function playNotifSound() {
          try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            var notes = [783.99, 1046.50]; // Sol5 → Do6
            notes.forEach(function(freq, i) {
              var osc = ctx.createOscillator();
              var gain = ctx.createGain();
              osc.connect(gain); gain.connect(ctx.destination);
              osc.type = 'sine';
              osc.frequency.value = freq;
              var t = ctx.currentTime + i * 0.18;
              gain.gain.setValueAtTime(0, t);
              gain.gain.linearRampToValueAtTime(0.28, t + 0.02);
              gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
              osc.start(t); osc.stop(t + 0.55);
            });
          } catch(e) {}
        }

        // Toast notification nouveau RDV
        function showRdvToast(appt) {
          var existing = document.getElementById('shell-rdv-toast');
          if (existing) existing.remove();
          var el = document.createElement('div');
          el.id = 'shell-rdv-toast';
          el.style.cssText = 'position:fixed;bottom:28px;right:24px;z-index:9999;display:flex;align-items:center;gap:12px;padding:14px 18px;border-radius:14px;background:#fff;box-shadow:0 8px 32px rgba(0,0,0,.18);border:1px solid #E8E3F5;min-width:280px;max-width:360px;animation:rdvToastIn .3s cubic-bezier(.34,1.56,.64,1)';
          el.innerHTML = '<div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#3B1772,#7C3AED);display:flex;align-items:center;justify-content:center;flex-shrink:0">'
            +'<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="m9 16 2 2 4-4"/></svg></div>'
            +'<div style="flex:1;min-width:0">'
            +'<div style="font-size:13px;font-weight:700;color:#1a1a2e;margin-bottom:2px">Nouveau rendez-vous 📅</div>'
            +'<div style="font-size:12px;color:#6B7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(appt.patient_name||'Patient')+' · '+(appt.requested_time||'')+'</div>'
            +'</div>'
            +'<button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:#9CA3AF;font-size:18px;line-height:1;padding:2px">×</button>';
          if (!document.getElementById('rdvToastAnim')) {
            var s = document.createElement('style');
            s.id = 'rdvToastAnim';
            s.textContent = '@keyframes rdvToastIn{from{transform:translateY(20px) scale(.95);opacity:0}to{transform:none;opacity:1}}';
            document.head.appendChild(s);
          }
          document.body.appendChild(el);
          setTimeout(function(){ if(el.parentNode) el.remove(); }, 6000);
        }

        // Mises à jour en temps réel (INSERT = nouvelle demande, UPDATE = annulation/confirmation)
        _rdvClient.channel('shell-rdv-' + uid)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'appointments', filter: 'doctor_id=eq.' + uid },
            function(payload) {
              refresh();
              playNotifSound();
              showRdvToast(payload.new || {});
            })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'appointments' }, refresh)
          .subscribe();
      });
    } catch (e) { /* Badge non critique — échec silencieux */ }
  }

  // ── ONBOARDING ────────────────────────────────────────────────
  var _OB_KEY = 'docline_ob_v1';
  var _obStep = 0;

  var _OB_STEPS = [
    {
      chip: 'Bienvenue',
      title: 'Votre cabinet médical numérique',
      desc: 'Docline centralise vos patients, consultations et rendez-vous. Suivez ce guide pour tout configurer en 4 étapes.',
      illo: '<svg viewBox="0 0 180 130" width="180" height="130" xmlns="http://www.w3.org/2000/svg">'
          + '<rect x="10" y="20" width="160" height="90" rx="14" fill="#EDE8FF"/>'
          + '<rect x="24" y="34" width="60" height="62" rx="10" fill="#3B1772"/>'
          + '<circle cx="54" cy="55" r="14" fill="#fff" opacity=".9"/>'
          + '<rect x="30" y="76" width="48" height="6" rx="3" fill="#fff" opacity=".5"/>'
          + '<rect x="30" y="86" width="36" height="5" rx="2.5" fill="#fff" opacity=".3"/>'
          + '<rect x="94" y="34" width="62" height="18" rx="6" fill="#fff" opacity=".8"/>'
          + '<rect x="100" y="40" width="30" height="5" rx="2.5" fill="#3B1772" opacity=".4"/>'
          + '<rect x="94" y="58" width="62" height="18" rx="6" fill="#fff" opacity=".8"/>'
          + '<rect x="100" y="64" width="42" height="5" rx="2.5" fill="#3B1772" opacity=".4"/>'
          + '<rect x="94" y="78" width="62" height="18" rx="6" fill="#7C3AED" opacity=".8"/>'
          + '<rect x="100" y="84" width="28" height="5" rx="2.5" fill="#fff" opacity=".6"/>'
          + '<circle cx="148" cy="26" r="10" fill="#7C3AED"/>'
          + '<path d="M144 26l2.5 2.5L152 23" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/>'
          + '</svg>',
    },
    {
      chip: 'Étape 1 — Profil',
      title: 'Complétez votre fiche publique',
      desc: 'Renseignez votre spécialité, votre adresse et une photo de profil. Les patients vous trouveront via la plateforme.',
      illo: '<svg viewBox="0 0 180 130" width="180" height="130" xmlns="http://www.w3.org/2000/svg">'
          + '<rect x="20" y="10" width="140" height="110" rx="14" fill="#F3F0FF"/>'
          + '<rect x="36" y="22" width="108" height="70" rx="10" fill="#fff" stroke="#E8EAF0" stroke-width="1.5"/>'
          + '<circle cx="70" cy="50" r="18" fill="#EDE8FF"/>'
          + '<circle cx="70" cy="46" r="8" fill="#7C3AED" opacity=".7"/>'
          + '<path d="M54 66c0-8.8 7.2-10 16-10s16 1.2 16 10" fill="#7C3AED" opacity=".4"/>'
          + '<rect x="96" y="36" width="36" height="6" rx="3" fill="#3B1772" opacity=".6"/>'
          + '<rect x="96" y="48" width="24" height="5" rx="2.5" fill="#7B8194" opacity=".5"/>'
          + '<rect x="96" y="59" width="42" height="5" rx="2.5" fill="#7B8194" opacity=".3"/>'
          + '<rect x="96" y="70" width="20" height="14" rx="4" fill="#3B1772" opacity=".8"/>'
          + '<rect x="36" y="100" width="108" height="12" rx="6" fill="#EDE8FF"/>'
          + '<rect x="36" y="100" width="72" height="12" rx="6" fill="#3B1772" opacity=".7"/>'
          + '</svg>',
      href: 'profil-public.html',
    },
    {
      chip: 'Étape 2 — Disponibilités',
      title: 'Définissez vos créneaux',
      desc: 'Indiquez vos jours et horaires de travail. Les patients ne pourront réserver que sur ces créneaux.',
      illo: '<svg viewBox="0 0 180 130" width="180" height="130" xmlns="http://www.w3.org/2000/svg">'
          + '<rect x="16" y="10" width="148" height="110" rx="14" fill="#F3F0FF"/>'
          + '<rect x="28" y="22" width="124" height="90" rx="10" fill="#fff" stroke="#E8EAF0" stroke-width="1.5"/>'
          + '<rect x="28" y="22" width="124" height="22" rx="10" fill="#3B1772"/>'
          + '<rect x="28" y="32" width="124" height="12" rx="0" fill="#3B1772"/>'
          + '<rect x="34" y="26" width="30" height="10" rx="3" fill="#fff" opacity=".2"/>'
          + '<text x="90" y="37" text-anchor="middle" fill="#fff" font-size="8" font-weight="700" font-family="sans-serif">Lun — Ven</text>'
          + '<rect x="34" y="50" width="24" height="18" rx="5" fill="#EDE8FF"/>'
          + '<rect x="34" y="50" width="24" height="18" rx="5" fill="#3B1772" opacity=".7"/>'
          + '<rect x="64" y="50" width="24" height="18" rx="5" fill="#EDE8FF"/>'
          + '<rect x="64" y="50" width="24" height="18" rx="5" fill="#3B1772" opacity=".7"/>'
          + '<rect x="94" y="50" width="24" height="18" rx="5" fill="#EDE8FF"/>'
          + '<rect x="124" y="50" width="24" height="18" rx="5" fill="#EDE8FF"/>'
          + '<rect x="34" y="74" width="24" height="18" rx="5" fill="#3B1772" opacity=".7"/>'
          + '<rect x="64" y="74" width="24" height="18" rx="5" fill="#EDE8FF"/>'
          + '<rect x="94" y="74" width="24" height="18" rx="5" fill="#3B1772" opacity=".7"/>'
          + '<rect x="124" y="74" width="24" height="18" rx="5" fill="#3B1772" opacity=".7"/>'
          + '<rect x="34" y="98" width="114" height="8" rx="4" fill="#EDE8FF"/>'
          + '</svg>',
      href: 'disponibilites.html',
    },
    {
      chip: 'Étape 3 — Booking',
      title: 'Partagez votre lien de RDV',
      desc: 'Votre page de réservation est prête. Envoyez le lien à vos patients par WhatsApp, SMS ou email.',
      illo: '<svg viewBox="0 0 180 130" width="180" height="130" xmlns="http://www.w3.org/2000/svg">'
          + '<rect x="54" y="5" width="72" height="120" rx="12" fill="#0C0E14"/>'
          + '<rect x="58" y="12" width="64" height="106" rx="9" fill="#F7F8FC"/>'
          + '<rect x="62" y="20" width="56" height="8" rx="4" fill="#EDE8FF"/>'
          + '<rect x="62" y="20" width="38" height="8" rx="4" fill="#3B1772" opacity=".5"/>'
          + '<rect x="66" y="34" width="48" height="32" rx="6" fill="#fff" stroke="#E8EAF0" stroke-width="1"/>'
          + '<circle cx="82" cy="46" r="8" fill="#EDE8FF"/>'
          + '<circle cx="82" cy="44" r="4" fill="#7C3AED" opacity=".6"/>'
          + '<rect x="93" y="38" width="16" height="4" rx="2" fill="#3B1772" opacity=".5"/>'
          + '<rect x="93" y="46" width="12" height="3" rx="1.5" fill="#7B8194" opacity=".4"/>'
          + '<rect x="93" y="53" width="20" height="8" rx="3" fill="#3B1772" opacity=".7"/>'
          + '<rect x="66" y="72" width="48" height="5" rx="2.5" fill="#EDE8FF"/>'
          + '<rect x="66" y="72" width="32" height="5" rx="2.5" fill="#7C3AED" opacity=".4"/>'
          + '<rect x="66" y="83" width="20" height="14" rx="5" fill="#3B1772" opacity=".9"/>'
          + '<rect x="90" y="83" width="24" height="14" rx="5" fill="#EDE8FF"/>'
          + '<circle cx="90" cy="110" r="4" fill="#3B1772" opacity=".5"/>'
          + '</svg>',
      href: '/mes-rdv',
    },
    {
      chip: 'Tout est prêt',
      title: 'Vous êtes prêt à démarrer',
      desc: 'Votre espace Docline est configuré. Vos patients peuvent maintenant prendre rendez-vous en ligne. Bonne pratique !',
      illo: '<svg viewBox="0 0 180 130" width="180" height="130" xmlns="http://www.w3.org/2000/svg">'
          + '<circle cx="90" cy="65" r="48" fill="#EDE8FF"/>'
          + '<circle cx="90" cy="65" r="36" fill="#3B1772" opacity=".15"/>'
          + '<circle cx="90" cy="65" r="24" fill="#3B1772"/>'
          + '<path d="M78 65l8 8 16-16" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
          + '<circle cx="38" cy="28" r="5" fill="#7C3AED" opacity=".5"/>'
          + '<circle cx="148" cy="40" r="3.5" fill="#3B1772" opacity=".4"/>'
          + '<circle cx="28" cy="90" r="3" fill="#6D28D9" opacity=".4"/>'
          + '<circle cx="155" cy="95" r="5" fill="#7C3AED" opacity=".3"/>'
          + '<circle cx="60" cy="18" r="2.5" fill="#3B1772" opacity=".3"/>'
          + '<circle cx="130" cy="110" r="2" fill="#6D28D9" opacity=".5"/>'
          + '</svg>',
      last: true,
    },
  ];

  function _obRender() {
    var s   = _OB_STEPS[_obStep];
    var total = _OB_STEPS.length;
    var pct = Math.round((_obStep / (total - 1)) * 100);
    var modal = document.getElementById('ob-modal');
    if (!modal) return;

    var dots = _OB_STEPS.map(function(_, i) {
      return '<div class="ob-dot' + (i === _obStep ? ' on' : '') + '"></div>';
    }).join('');

    var btnLabel = s.last ? 'Commencer' : 'Suivant';
    var btnIcon  = s.last
      ? '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>'
      : '<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

    // Lien "Accéder" discret sous la description (si la step a une page associée)
    var accessLink = s.href
      ? '<a href="' + s.href + '" class="ob-access-link" target="_self">'
        + '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
        + 'Accéder à cette page</a>'
      : '';

    modal.innerHTML =
      '<div class="ob-bar"><div class="ob-fill" id="ob-fill" style="width:' + pct + '%"></div></div>'
    + '<div class="ob-body">'
    +   '<div class="ob-illo"><div class="ob-illo-inner" id="ob-illo-inner">' + s.illo + '</div></div>'
    +   '<div class="ob-chip">' + s.chip + '</div>'
    +   '<div class="ob-title">' + s.title + '</div>'
    +   '<div class="ob-desc">' + s.desc + '</div>'
    +   accessLink
    + '</div>'
    + '<div class="ob-foot">'
    +   '<div class="ob-dots">' + dots + '</div>'
    +   (!s.last ? '<button class="ob-skip" id="ob-skip">Ignorer</button>' : '')
    +   '<button class="ob-btn" id="ob-next">' + btnLabel + btnIcon + '</button>'
    + '</div>';

    // "Suivant" : toujours avancer dans les étapes, jamais rediriger
    document.getElementById('ob-next').addEventListener('click', function() {
      if (s.last) {
        _obClose();
      } else {
        _obNext();
      }
    });

    var skipBtn = document.getElementById('ob-skip');
    if (skipBtn) skipBtn.addEventListener('click', _obClose);
  }

  function _obNext() {
    if (_obStep < _OB_STEPS.length - 1) {
      _obStep++;
      // Re-render avec animation de l'illustration
      var modal = document.getElementById('ob-modal');
      if (!modal) return;
      _obRender();
    }
  }

  function _obClose() {
    localStorage.setItem(_OB_KEY, '1');
    var ov = document.getElementById('ob-ov');
    if (ov) {
      ov.style.animation = 'ob-bg .3s ease reverse forwards';
      setTimeout(function(){ ov.remove(); }, 300);
    }
  }

  function _launchOnboarding() {
    if (localStorage.getItem(_OB_KEY)) return;
    // Délai pour laisser le shell se charger
    setTimeout(function() {
      _obStep = 0;
      var ov = document.createElement('div');
      ov.id = 'ob-ov';
      ov.innerHTML = '<div id="ob-modal"></div>';
      document.body.appendChild(ov);
      _obRender();
      // Fermer sur clic backdrop
      ov.addEventListener('click', function(e) {
        if (e.target === ov) _obClose();
      });
      // Fermer à Escape
      document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') { _obClose(); document.removeEventListener('keydown', onEsc); }
      });
    }, 600);
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

    // ── Profile popover
    var userBtn = document.getElementById('sb-user-btn');
    var popWrap = document.getElementById('sb-pop-wrap');
    var footer  = document.getElementById('sb-footer');

    if (userBtn && popWrap) {
      // Calcule les initiales pour le popover (même logique que render())
      var _un  = opts.userName  || '';
      var _ue  = opts.userEmail || '';
      var _ini = _un
        ? _un.split(' ').map(function(w){ return w[0]||''; }).join('').toUpperCase().slice(0,2)
        : ((_ue[0]||'?').toUpperCase());
      var popOpts = {
        initials:  _ini,
        userName:  _un,
        userEmail: _ue,
        plan:      opts.plan || 'free',
      };

      function _togglePop(e) {
        if (e) e.stopPropagation();
        var existing = document.getElementById('sb-profile-pop');
        if (existing) {
          existing.remove();
          if (footer) footer.classList.remove('pop-open');
        } else {
          popWrap.insertAdjacentHTML('afterbegin', _buildProfilePop(popOpts));
          if (footer) footer.classList.add('pop-open');

          // Signout button inside the popover
          var signoutBtn = document.getElementById('sb-pop-signout');
          if (signoutBtn) {
            signoutBtn.addEventListener('click', function() {
              if (typeof Auth !== 'undefined') Auth.signOut();
            });
          }
        }
      }

      userBtn.addEventListener('click', _togglePop);

      // Fermeture au clic en dehors
      document.addEventListener('click', function(e) {
        var pop = document.getElementById('sb-profile-pop');
        if (pop && popWrap && !popWrap.contains(e.target)) {
          pop.remove();
          if (footer) footer.classList.remove('pop-open');
        }
      });

      // Fermeture à l'Échap
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          var pop = document.getElementById('sb-profile-pop');
          if (pop) { pop.remove(); if (footer) footer.classList.remove('pop-open'); }
        }
      });
    }

    // ── Peek arrow (créé une fois, commun desktop + mobile) ───────────
    var _peek = document.getElementById('sb-peek');
    if (!_peek) {
      _peek = document.createElement('div');
      _peek.id = 'sb-peek';
      _peek.className = 'sb-peek';
      _peek.title = 'Afficher le menu';
      _peek.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>';
      document.body.appendChild(_peek);
    }

    var _appShell = document.querySelector('.app-shell');

    if (window.innerWidth > 768) {
      // ── DESKTOP : auto-hide + peek depuis le bord gauche ──────────
      var _autoHideTimer = null;

      function _getSbW() { return sb ? sb.getBoundingClientRect().width : 228; }

      function _hideSb() {
        if (_appShell) _appShell.classList.add('sb-hidden');
        setTimeout(function() { _peek.classList.add('on'); }, 280);
      }
      function _showSb() {
        if (_appShell) _appShell.classList.remove('sb-hidden');
        _peek.classList.remove('on');
        if (_autoHideTimer) { clearTimeout(_autoHideTimer); _autoHideTimer = null; }
      }

      document.addEventListener('mousemove', function(e) {
        if (window.innerWidth <= 768) return;
        var hidden = _appShell && _appShell.classList.contains('sb-hidden');
        if (!hidden) {
          if (e.clientX > _getSbW() + 60) {
            if (!_autoHideTimer) {
              _autoHideTimer = setTimeout(function() {
                _hideSb(); _autoHideTimer = null;
              }, 500);
            }
          } else {
            if (_autoHideTimer) { clearTimeout(_autoHideTimer); _autoHideTimer = null; }
          }
        } else {
          if (e.clientX <= 28) { _showSb(); }
        }
      }, { passive: true });

      if (sb) {
        sb.addEventListener('mouseenter', function() {
          if (_autoHideTimer) { clearTimeout(_autoHideTimer); _autoHideTimer = null; }
        });
      }
      _peek.addEventListener('mouseenter', _showSb);
      _peek.addEventListener('click', _showSb);

    } else {
      // ── MOBILE : peek en bas, s'affiche quand le drawer est fermé ──
      function _peekMobileUpdate() {
        if (sb && sb.classList.contains('open')) {
          _peek.classList.remove('on');
        } else {
          _peek.classList.add('on');
        }
      }

      // Affiche la flèche après un court instant au chargement
      setTimeout(_peekMobileUpdate, 700);

      // Tap sur la flèche → ouvre le drawer
      _peek.addEventListener('click', function() {
        if (sb) {
          sb.classList.add('open');
          if (ov) ov.classList.add('open');
          _peek.classList.remove('on');
        }
      });

      // Quand le drawer se ferme (overlay ou ham), réafficher la flèche
      if (ov) {
        ov.addEventListener('click', function() {
          setTimeout(_peekMobileUpdate, 250);
        });
      }
      if (ham) {
        ham.addEventListener('click', function() {
          setTimeout(_peekMobileUpdate, 250);
        });
      }
    }

    // Lance le voyant RDV en attente (léger délai pour laisser supabase se charger)
    setTimeout(_watchRdv, 250);

    // Lance l'onboarding à la première connexion
    _launchOnboarding();

    // Heartbeat last_seen_at — toutes les 5 min
    _startHeartbeat();

    // Email de bienvenue à la première connexion
    _sendWelcomeIfNeeded();
  }

  var _heartbeatInterval = null;
  function _startHeartbeat() {
    _pingLastSeen();
    if (_heartbeatInterval) clearInterval(_heartbeatInterval);
    _heartbeatInterval = setInterval(_pingLastSeen, 5 * 60 * 1000);
  }

  function _sendWelcomeIfNeeded() {
    var url = (typeof SUPA_URL !== 'undefined') ? SUPA_URL : null;
    var key = (typeof SUPA_KEY !== 'undefined') ? SUPA_KEY : null;
    if (!url || !key) return;
    if (!_rdvClient) _rdvClient = supabase.createClient(url, key);
    _rdvClient.auth.getSession().then(function(res) {
      var sess = res && res.data && res.data.session;
      if (!sess) return;
      _rdvClient.from('profiles').select('welcome_email_sent').eq('id', sess.user.id).single().then(function(r) {
        if (r.data && !r.data.welcome_email_sent) {
          _rdvClient.functions.invoke('send-email', { body: { type: 'welcome' } }).then(function() {});
        }
      });
    });
  }

  function _pingLastSeen() {
    var url = (typeof SUPA_URL !== 'undefined') ? SUPA_URL : null;
    var key = (typeof SUPA_KEY !== 'undefined') ? SUPA_KEY : null;
    if (!url || !key) return;
    if (!_rdvClient) _rdvClient = supabase.createClient(url, key);
    _rdvClient.auth.getSession().then(function(res) {
      var sess = res && res.data && res.data.session;
      if (!sess) return;
      _rdvClient.from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', sess.user.id)
        .then(function() {});
    });
  }

  // Helper: compute the display name from auth user metadata.
  // Cliniques affichent le nom de la clinique, sinon nom du médecin/email.
  function displayName(meta, email) {
    meta = meta || {};
    if (meta.is_clinic && meta.clinic_name) return meta.clinic_name;
    return meta.full_name || meta.name || (email ? String(email).split('@')[0] : '') || 'Mon compte';
  }

  // ── ACCOUNT GUARD (suspension) ───────────────────────────────
  // Appelé par chaque page après Shell.init(), avec l'objet sub déjà fetchée :
  //   if (typeof Shell.guard === 'function' && !Shell.guard(sub)) return;
  // Retourne false et affiche un overlay si le compte est suspendu.
  function guard(sub) {
    if (!sub) return true; // pas de données = on laisse passer (erreur réseau)
    if (sub.status === 'suspended') {
      _showSuspended();
      return false;
    }
    return true;
  }

  function _showSuspended() {
    var ov = document.createElement('div');
    ov.className = 'shell-no-access';
    ov.innerHTML =
        '<div class="shell-no-access-ico" style="background:#FFF7ED">'
      + '<svg viewBox="0 0 24 24" style="width:32px;height:32px;fill:none;stroke:#D97706;stroke-width:1.8;stroke-linecap:round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      + '</div>'
      + '<div class="shell-no-access-title">Compte suspendu</div>'
      + '<div class="shell-no-access-sub">Votre compte a ete suspendu par l\'administrateur.<br>Regularisez votre situation pour retrouver l\'acces.</div>'
      + '<a href="mailto:support@docline.dz" class="shell-no-access-back" style="text-decoration:none">Contacter le support</a>';
    document.body.appendChild(ov);
    var main = document.querySelector('.shell-main');
    if (main) main.style.visibility = 'hidden';
  }

  // ── STAFF ACCESS CONTROL ──────────────────────────────────────
  // Pages accessibles par clé → fichier HTML
  var _PAGE_HREFS = {
    'queue':        'queue.html',
    'clients':      '/patients',
    'calendar':     '/calendar',
    'mes-rdv':      '/mes-rdv',
    'consultations':'consultations.html',
    'labo':         'labo.html',
    'ordonnances':  'ordonnances.html',
    'staff':        'staff.html',
    'disponibilites':'disponibilites.html',
    'profil-public':'profil-public.html',
  };
  // Ordre de priorité pour la redirection automatique depuis le dashboard
  var _REDIRECT_PRIORITY = ['queue','clients','calendar','mes-rdv','consultations','labo','ordonnances','staff'];

  // Appelé par chaque page après Shell.init() :
  //   Shell.checkStaff(_supa, 'queue', "File d'attente");
  // Pour le médecin : ne fait rien (accès total).
  // Pour le staff :
  //   - sur le dashboard → redirige vers la première page accessible
  //   - sur les autres pages → cache les items interdits dans la sidebar
  //   - si la page courante est interdite → affiche l'overlay "Accès refusé"
  function checkStaff(supaClient, pageKey, pageLabel) {
    try {
      supaClient.auth.getSession().then(function(res) {
        var session = res && res.data && res.data.session;
        if (!session) return;
        supaClient
          .from('staff')
          .select('page_access, role, clinic_id')
          .eq('user_id', session.user.id)
          .single()
          .then(function(result) {
            if (!result.data) return; // médecin propriétaire → accès total, rien à faire

            var access = result.data.page_access || [];

            // ── Dashboard : redirection automatique vers la première page accessible
            if (pageKey === 'dashboard') {
              for (var i = 0; i < _REDIRECT_PRIORITY.length; i++) {
                var k = _REDIRECT_PRIORITY[i];
                if (access.indexOf(k) !== -1 && _PAGE_HREFS[k]) {
                  window.location.replace(_PAGE_HREFS[k]);
                  return;
                }
              }
              return; // aucune page accessible → reste sur le dashboard
            }

            // ── Sidebar : cacher complètement les pages interdites
            NAV.forEach(function(n) {
              if (n.section) return;
              if (access.indexOf(n.key) === -1) {
                var el = document.querySelector('.sb-item[data-key="' + n.key + '"]');
                if (el) el.style.display = 'none';
              }
            });

            // ── Cacher les titres de section dont tous les items sont cachés
            var sectionEls = document.querySelectorAll('.sb-section');
            sectionEls.forEach(function(sEl) {
              var sibling = sEl.nextElementSibling;
              var hasVisible = false;
              while (sibling && !sibling.classList.contains('sb-section')) {
                if (sibling.style.display !== 'none' && sibling.classList.contains('sb-item')) {
                  hasVisible = true;
                  break;
                }
                sibling = sibling.nextElementSibling;
              }
              if (!hasVisible) sEl.style.display = 'none';
            });

            // ── Page courante interdite → overlay "Accès refusé"
            if (pageKey && access.indexOf(pageKey) === -1) {
              _showNoAccessPage(pageLabel || pageKey);
            }
          }).catch(function() {});
      });
    } catch(e) { /* silence */ }
  }

  function _showNoAccessPage(pageLabel) {
    var ov = document.createElement('div');
    ov.className = 'shell-no-access';
    ov.innerHTML =
        '<div class="shell-no-access-ico">'
      + '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
      + '</div>'
      + '<div class="shell-no-access-title">Acces refuse</div>'
      + '<div class="shell-no-access-sub">Ce compte ne dispose pas des droits pour acceder a <strong>'
      + (pageLabel || 'cette page')
      + '</strong>.<br>Contactez votre responsable pour obtenir l\'acces.</div>'
      + '<button class="shell-no-access-back" onclick="history.back()">'
      + '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round"><polyline points="15 18 9 12 15 6"/></svg>'
      + 'Retour'
      + '</button>';
    document.body.appendChild(ov);
    var main = document.querySelector('.shell-main');
    if (main) main.style.visibility = 'hidden';
  }

  return { init: init, render: render, displayName: displayName, setRdvBadge: _setRdvBadge, checkStaff: checkStaff, guard: guard, resetOnboarding: function(){ localStorage.removeItem(_OB_KEY); } };
})();
