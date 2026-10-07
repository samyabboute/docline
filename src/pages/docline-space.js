/* Docline — bouton « Mon espace » : choix Patient / Professionnel de santé.
   Usage : <button data-space-menu>…</button>. Panneau animé (pop depuis le bouton sur ordinateur,
   feuille du bas sur mobile), navigation en glissement entre « Vous êtes », espace patient et espace pro. */
(function () {
  'use strict';
  if (window.__doclineSpace) return;
  window.__doclineSpace = true;

  var CSS =
    '.ds-scrim{position:fixed;inset:0;z-index:1001;background:rgba(13,5,32,0);pointer-events:none;transition:background .35s cubic-bezier(.22,1,.36,1)}' +
    '.ds-scrim.on{pointer-events:auto}' +
    '.ds-pop{position:fixed;z-index:1002;width:360px;max-width:calc(100vw - 24px);background:rgba(255,255,255,.92);' +
      '-webkit-backdrop-filter:saturate(180%) blur(24px);backdrop-filter:saturate(180%) blur(24px);' +
      'border:1px solid rgba(13,5,32,.08);border-radius:22px;box-shadow:0 1px 2px rgba(13,5,32,.05),0 24px 60px -18px rgba(13,5,32,.30);' +
      'font-family:Inter,system-ui,-apple-system,sans-serif;color:#0D0520;overflow:hidden;' +
      'opacity:0;transform:translateY(-8px) scale(.94);filter:blur(6px);transform-origin:top right;pointer-events:none;visibility:hidden;' +
      'transition:opacity .32s cubic-bezier(.22,1,.36,1),transform .42s cubic-bezier(.22,1,.36,1),filter .32s cubic-bezier(.22,1,.36,1),visibility 0s linear .42s}' +
    '.ds-pop.on{opacity:1;transform:none;filter:none;pointer-events:auto;visibility:visible;transition-delay:0s}' +
    '.ds-viewport{overflow:hidden;transition:height .42s cubic-bezier(.22,1,.36,1)}' +
    '.ds-track{display:flex;align-items:flex-start;width:300%;transition:transform .48s cubic-bezier(.22,1,.36,1)}' +
    '.ds-pane{width:33.3333%;padding:18px;box-sizing:border-box}' +
    '.ds-eyebrow{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#A29DB0;margin:2px 4px 4px}' +
    '.ds-title{font-size:22px;font-weight:700;letter-spacing:-.03em;margin:0 4px 14px;line-height:1.15}' +
    '.ds-opt{display:flex;align-items:center;gap:14px;width:100%;text-align:left;border:0;background:transparent;cursor:pointer;' +
      'padding:14px;border-radius:16px;color:inherit;font:inherit;text-decoration:none;transition:background .2s,transform .3s cubic-bezier(.22,1,.36,1)}' +
    '.ds-opt+.ds-opt{margin-top:4px}' +
    '.ds-opt:focus{outline:none}.ds-opt:focus-visible{background:#F4F2F8}' +
    '.ds-opt:active{transform:scale(.985)}' +
    '.ds-ic{width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:#F1EEFA;color:#4C1D95;transition:background .25s,color .25s}' +
    '.ds-opt:hover .ds-ic{background:#4C1D95;color:#fff}' +
    '.ds-ic svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}' +
    '.ds-txt{flex:1;min-width:0}' +
    '.ds-txt b{display:block;font-size:15px;font-weight:600;letter-spacing:-.01em}' +
    '.ds-txt span{display:block;font-size:12.5px;color:#6E6880;margin-top:2px;line-height:1.35}' +
    '.ds-chev{width:16px;height:16px;fill:none;stroke:#A29DB0;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;transition:transform .3s cubic-bezier(.22,1,.36,1),stroke .2s}' +
    '.ds-opt:hover .ds-chev{transform:translateX(3px);stroke:#4C1D95}' +
    '.ds-back{display:inline-flex;align-items:center;gap:4px;border:0;background:none;cursor:pointer;font:600 13px Inter,system-ui,sans-serif;color:#4C1D95;padding:4px 6px;margin:0 0 8px -2px;border-radius:8px}' +
    '.ds-back:hover{background:#F1EEFA}' +
    '.ds-back:focus{outline:none}.ds-back:focus-visible{box-shadow:0 0 0 3px rgba(76,29,149,.25)}' +
    '.ds-opt:hover{background:#F4F2F8}' +
    '.ds-auth{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 6px}' +
    '.ds-auth a{display:flex;flex-direction:column;justify-content:center;gap:2px;min-height:62px;padding:10px 14px;border-radius:16px;text-decoration:none;' +
      'font:600 14.5px Inter,system-ui,sans-serif;letter-spacing:-.01em;transition:background .2s,transform .3s cubic-bezier(.22,1,.36,1),box-shadow .2s}' +
    '.ds-auth a small{font-weight:500;font-size:11.5px;letter-spacing:0;opacity:.75}' +
    '.ds-auth a:active{transform:scale(.98)}' +
    '.ds-auth .ds-in{background:#F4F2F8;color:#0D0520}.ds-auth .ds-in:hover{background:#ECE8F4}' +
    '.ds-auth .ds-up{background:#4C1D95;color:#fff;box-shadow:0 8px 20px -10px rgba(76,29,149,.7)}.ds-auth .ds-up:hover{background:#5B21B6}' +
    '.ds-auth a:focus{outline:none}.ds-auth a:focus-visible{box-shadow:0 0 0 3px rgba(76,29,149,.3)}' +
    '.ds-sep{display:flex;align-items:center;gap:10px;margin:14px 4px 4px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#A29DB0}' +
    '.ds-sep:after{content:"";flex:1;height:1px;background:rgba(13,5,32,.08)}' +
    '.ds-hello{display:flex;align-items:center;gap:12px;padding:12px 14px;margin:0 0 6px;border-radius:16px;background:#4C1D95;color:#fff;text-decoration:none;transition:background .2s}' +
    '.ds-hello:hover{background:#5B21B6}.ds-hello:focus{outline:none}.ds-hello:focus-visible{box-shadow:0 0 0 3px rgba(76,29,149,.3)}' +
    '.ds-av{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;font:700 15px Inter,system-ui,sans-serif;flex-shrink:0}' +
    '.ds-hello b{display:block;font-size:15px;font-weight:600}.ds-hello span{display:block;font-size:12.5px;opacity:.8;margin-top:1px}' +
    '.ds-hello .ds-chev{stroke:#fff;margin-left:auto}' +
    '.ds-back svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}' +
    '.ds-primary{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:46px;margin-top:6px;border-radius:999px;' +
      'background:#4C1D95;color:#fff;font:600 15px Inter,system-ui,sans-serif;text-decoration:none;transition:background .2s}' +
    '.ds-primary:hover{background:#5B21B6}' +
    '.ds-note{display:flex;gap:8px;align-items:flex-start;margin:12px 4px 2px;font-size:12px;color:#6E6880;line-height:1.45}' +
    '.ds-note svg{width:14px;height:14px;flex-shrink:0;margin-top:1px;fill:none;stroke:#1E7F4E;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.ds-pane .ds-opt{opacity:0;transform:translateY(6px)}' +
    '.ds-pop.on .ds-pane.cur .ds-opt{opacity:1;transform:none;transition:opacity .4s cubic-bezier(.22,1,.36,1),transform .45s cubic-bezier(.22,1,.36,1),background .2s}' +
    '.ds-pop.on .ds-pane.cur .ds-opt:nth-of-type(2){transition-delay:.05s,.05s,0s}' +
    '.ds-pop.on .ds-pane.cur .ds-opt:nth-of-type(3){transition-delay:.1s,.1s,0s}' +
    '[data-space-menu] .ds-btn-chev{transition:transform .35s cubic-bezier(.22,1,.36,1)}' +
    '[data-space-menu][aria-expanded="true"] .ds-btn-chev{transform:rotate(180deg)}' +
    '@media(max-width:640px){' +
      '.ds-scrim.on{background:rgba(13,5,32,.28)}' +
      '.ds-pop{left:8px!important;right:8px!important;top:auto!important;bottom:calc(8px + env(safe-area-inset-bottom,0px));width:auto;max-width:none;border-radius:26px;' +
        'transform:translateY(110%);filter:none;transform-origin:bottom center}' +
      '.ds-pop.on{transform:none}' +
      '.ds-pane{padding:20px 18px 18px}' +
      '.ds-grab{width:38px;height:5px;border-radius:3px;background:rgba(13,5,32,.15);margin:10px auto 0}' +
    '}' +
    '@media(min-width:641px){.ds-grab{display:none}}' +
    '@media(prefers-reduced-motion:reduce){.ds-pop,.ds-track,.ds-viewport,.ds-pane .ds-opt{transition:none!important;filter:none!important}}';

  var I = {
    patient: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    pro: '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
    lab: '<path d="M9 2v6L4 18a2 2 0 0 0 1.8 3h12.4a2 2 0 0 0 1.8-3L15 8V2"/><path d="M8 2h8M7 15h10"/>',
    login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    chev: '<path d="m9 18 6-6-6-6"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'
  };
  function svg(k, cls) { return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + I[k] + '</svg>'; }
  function opt(tag, attrs, icon, title, sub) {
    return '<' + tag + ' class="ds-opt" ' + attrs + '><span class="ds-ic">' + svg(icon) + '</span><span class="ds-txt"><b>' + title +
      '</b><span>' + sub + '</span></span>' + svg('chev', 'ds-chev') + '</' + tag + '>';
  }

  var onSearchPage = !!document.getElementById('s-smart');
  var bookHref = onSearchPage ? '#' : '/find-doctor';

  var session = null, pName = '';
  try { session = localStorage.getItem('docline_patient_session'); pName = localStorage.getItem('docline_patient_name') || ''; } catch (e) {}
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function patientAccount() {
    if (session) {
      var first = (pName.split(' ')[0] || '').trim();
      return '<a class="ds-hello" href="/patient"><span class="ds-av">' + (first ? esc(first.charAt(0).toUpperCase()) : svg('patient')) + '</span>' +
        '<span><b>' + (first ? 'Bonjour ' + esc(first) : 'Mon espace patient') + '</b><span>Rendez-vous, proches, résultats</span></span>' + svg('chev', 'ds-chev') + '</a>';
    }
    return '<div class="ds-auth"><a class="ds-in" href="/patient">Se connecter<small>J’ai déjà un compte</small></a>' +
      '<a class="ds-up" href="/patient#signup">Créer mon compte<small>Gratuit, sans mot de passe</small></a></div>';
  }

  function build() {
    var style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    var scrim = document.createElement('div'); scrim.className = 'ds-scrim';
    var pop = document.createElement('div');
    pop.className = 'ds-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Mon espace'); pop.setAttribute('aria-modal', 'false');
    pop.innerHTML = '<div class="ds-grab"></div><div class="ds-viewport"><div class="ds-track">' +
      '<section class="ds-pane cur" data-pane="0"><p class="ds-eyebrow">Mon espace</p><h2 class="ds-title">Vous êtes…</h2>' +
        opt('button', 'type="button" data-go="1"', 'patient', 'Patient', 'Rendez-vous, résultats d’analyses') +
        opt('button', 'type="button" data-go="2"', 'pro', 'Professionnel de santé', 'Agenda, patients, ordonnances') + '</section>' +
      '<section class="ds-pane" data-pane="1"><button type="button" class="ds-back" data-go="0">' + svg('back') + 'Vous êtes</button><h2 class="ds-title">Espace patient</h2>' +
        patientAccount() +
        '<p class="ds-sep">' + (session ? 'Raccourcis' : 'Ou sans compte') + '</p>' +
        opt('a', 'href="' + bookHref + '" data-book', 'cal', 'Prendre rendez-vous', 'Trouvez un médecin disponible près de chez vous') +
        opt('a', 'href="/results-view"', 'lab', 'Résultats d’analyses', 'Avec le code remis par votre médecin') +
        (session ? '' : '<p class="ds-note">' + svg('shield') + 'Le rendez-vous reste possible sans compte, confirmé par SMS.</p>') + '</section>' +
      '<section class="ds-pane" data-pane="2"><button type="button" class="ds-back" data-go="0">' + svg('back') + 'Vous êtes</button><h2 class="ds-title">Espace professionnel</h2>' +
        opt('a', 'href="/login"', 'login', 'Se connecter', 'Accéder à votre cabinet') +
        opt('a', 'href="/login#register"', 'plus', 'Créer mon espace', '30 jours gratuits, sans carte bancaire') + '</section>' +
      '</div></div>';
    document.body.appendChild(scrim);
    document.body.appendChild(pop);
    return { scrim: scrim, pop: pop };
  }

  var ui = null, btn = null, pane = 0, kbd = false;
  document.addEventListener('keydown', function () { kbd = true; }, true);
  document.addEventListener('pointerdown', function () { kbd = false; }, true);

  function setPane(n, instant) {
    pane = n;
    var track = ui.pop.querySelector('.ds-track'), vp = ui.pop.querySelector('.ds-viewport');
    var panes = ui.pop.querySelectorAll('.ds-pane');
    panes.forEach(function (p, i) { p.classList.toggle('cur', i === n); p.setAttribute('aria-hidden', i === n ? 'false' : 'true'); });
    if (instant) { track.style.transition = 'none'; vp.style.transition = 'none'; }
    track.style.transform = 'translateX(' + (-n * 33.3333) + '%)';
    vp.style.height = panes[n].offsetHeight + 'px';
    if (instant) { void track.offsetWidth; track.style.transition = ''; vp.style.transition = ''; }
    var f = panes[n].querySelector('.ds-opt, .ds-back');
    if (f && !instant && kbd) setTimeout(function () { f.focus({ preventScroll: true }); }, 60);
  }

  function place() {
    if (window.matchMedia('(max-width: 640px)').matches) { ui.pop.style.top = ''; ui.pop.style.right = ''; ui.pop.style.left = ''; return; }
    var r = btn.getBoundingClientRect();
    ui.pop.style.top = Math.round(r.bottom + 10) + 'px';
    ui.pop.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + 'px';
    ui.pop.style.left = 'auto';
  }

  function open(b) {
    btn = b;
    if (!ui) ui = build(), wire();
    place();
    setPane(0, true);
    ui.scrim.classList.add('on');
    ui.pop.classList.add('on');
    btn.setAttribute('aria-expanded', 'true');
    if (kbd) setTimeout(function () { var f = ui.pop.querySelector('.ds-pane.cur .ds-opt'); if (f) f.focus({ preventScroll: true }); }, 80);
  }
  function close(focusBack) {
    if (!ui || !ui.pop.classList.contains('on')) return;
    ui.pop.classList.remove('on');
    ui.scrim.classList.remove('on');
    if (btn) { btn.setAttribute('aria-expanded', 'false'); if (focusBack) btn.focus({ preventScroll: true }); }
  }

  function wire() {
    ui.scrim.addEventListener('click', function () { close(false); });
    ui.pop.addEventListener('click', function (e) {
      var go = e.target.closest('[data-go]');
      if (go) { setPane(+go.dataset.go); return; }
      var book = e.target.closest('[data-book]');
      if (book && onSearchPage) {
        e.preventDefault();
        close(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(function () { var s = document.getElementById('s-smart'); if (s) s.focus(); }, 450);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close(true);
    });
    window.addEventListener('resize', function () { if (ui.pop.classList.contains('on')) { place(); setPane(pane, true); } });
    window.addEventListener('scroll', function () { if (ui.pop.classList.contains('on') && !window.matchMedia('(max-width: 640px)').matches) place(); }, { passive: true });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-space-menu]');
    if (!b) return;
    e.preventDefault();
    if (ui && ui.pop.classList.contains('on')) close(false); else open(b);
  });
  document.querySelectorAll('[data-space-menu]').forEach(function (b) {
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
  });
})();
