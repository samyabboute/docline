/* Docline · satisfaction des médecins et des secrétaires (NPS)
 * Chargé par shell.js. Le serveur décide s'il faut poser la question (nps_should_ask) :
 * après 14 jours d'usage, puis une fois tous les 90 jours ; 21 jours de répit après « Plus tard ».
 */
(function () {
  if (window.__dlNps) return;
  window.__dlNps = true;
  try { if (sessionStorage.getItem('dl_nps_seen')) return; } catch (e) {}
  if (!window.supabase || typeof SUPA_URL === 'undefined') return;

  var sb = window.supabase.createClient(SUPA_URL, SUPA_KEY);
  var GOOD = [['simplicite', 'C’est simple'], ['file_attente', 'La file d’attente'], ['agenda', 'L’agenda'], ['ordonnances', 'Les ordonnances'],
              ['dossiers', 'Les dossiers patients'], ['rdv_en_ligne', 'Les rendez-vous en ligne'], ['rapidite', 'C’est rapide'], ['support', 'Le support']];
  var BAD = [['manque', 'Il manque une fonction'], ['lenteur', 'C’est lent'], ['bugs', 'Quelque chose ne marche pas'], ['simplicite', 'C’est compliqué'],
             ['prix', 'Le prix'], ['support', 'Le support'], ['agenda', 'L’agenda'], ['file_attente', 'La file d’attente'], ['ordonnances', 'Les ordonnances']];
  var score = null, reasons = {}, segment = 'doctor';

  function css() {
    var s = document.createElement('style');
    s.textContent =
      '.nps2{position:fixed;inset:0;z-index:9500;display:flex;align-items:flex-end;justify-content:center;background:rgba(13,5,32,.18);opacity:0;transition:opacity .3s ease;pointer-events:none;font-family:Inter,-apple-system,sans-serif}' +
      '.nps2.on{opacity:1;pointer-events:auto}' +
      '.nps2-s{width:100%;max-width:520px;background:rgba(255,255,255,.98);-webkit-backdrop-filter:saturate(1.6) blur(20px);backdrop-filter:saturate(1.6) blur(20px);border-radius:26px 26px 0 0;padding:26px 24px calc(22px + env(safe-area-inset-bottom,0px));box-shadow:0 -18px 50px rgba(13,5,32,.16);transform:translateY(100%);transition:transform .45s cubic-bezier(.22,1,.36,1)}' +
      '.nps2.on .nps2-s{transform:none}' +
      '@media(min-width:640px){.nps2{align-items:center}.nps2-s{border-radius:26px}}' +
      '.nps2-e{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6D28D9;margin-bottom:6px}' +
      '.nps2-q{font-size:18px;font-weight:800;color:#0D0520;letter-spacing:-.3px;line-height:1.3}' +
      '.nps2-scale{display:grid;grid-template-columns:repeat(11,1fr);gap:5px;margin-top:18px}' +
      '.nps2-scale button{aspect-ratio:1/1;border:1px solid rgba(13,5,32,.1);background:#fff;border-radius:11px;font:700 13.5px Inter,sans-serif;color:#2D1B69;cursor:pointer;padding:0;transition:all .15s}' +
      '.nps2-scale button:hover{border-color:#8B5CF6}' +
      '.nps2-scale button.on{background:#4C1D95;border-color:#4C1D95;color:#fff;transform:scale(1.06)}' +
      '.nps2-l{display:flex;justify-content:space-between;font-size:11px;color:#9C96B3;margin-top:6px}' +
      '.nps2-q2{font-size:14px;font-weight:700;color:#0D0520;margin:18px 0 10px}' +
      '.nps2-chips{display:flex;flex-wrap:wrap;gap:7px}' +
      '.nps2-chips button{border:1px solid rgba(13,5,32,.1);background:#fff;color:#2D1B69;font:600 12.5px Inter,sans-serif;padding:8px 12px;border-radius:999px;cursor:pointer}' +
      '.nps2-chips button.on{background:#4C1D95;border-color:#4C1D95;color:#fff}' +
      '.nps2 textarea{width:100%;box-sizing:border-box;margin-top:12px;border:1px solid rgba(13,5,32,.1);border-radius:14px;padding:10px 12px;font:500 13.5px/1.5 Inter,sans-serif;min-height:64px;resize:vertical;outline:none;background:#FCFBFF}' +
      '.nps2 textarea:focus{border-color:#8B5CF6;background:#fff}' +
      '.nps2-a{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:18px}' +
      '.nps2-later{border:0;background:none;color:#8A82A3;font:600 13px Inter,sans-serif;cursor:pointer;padding:8px 4px}' +
      '.nps2-send{border:0;border-radius:14px;background:#4C1D95;color:#fff;font:700 14px Inter,sans-serif;padding:12px 20px;cursor:pointer;box-shadow:0 8px 20px rgba(76,29,149,.22)}' +
      '.nps2-send:disabled{opacity:.45;cursor:default;box-shadow:none}' +
      '.nps2-done{text-align:center;padding:8px 0}' +
      '.nps2-ok{width:48px;height:48px;border-radius:50%;background:#ECFDF3;display:flex;align-items:center;justify-content:center;margin:0 auto 10px}' +
      '.nps2-ok svg{width:22px;height:22px;fill:none;stroke:#12B76A;stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round}' +
      '.nps2 button:focus-visible{outline:2px solid #8B5CF6;outline-offset:2px}' +
      '@media (prefers-reduced-motion:reduce){.nps2,.nps2-s{transition:none}}';
    document.head.appendChild(s);
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

  function render(box) {
    var q = segment === 'staff' ? 'Recommanderiez-vous Docline à un autre cabinet ?' : 'Recommanderiez-vous Docline à un confrère ?';
    var scale = '';
    for (var i = 0; i <= 10; i++) scale += '<button type="button" data-s="' + i + '" class="' + (score === i ? 'on' : '') + '" aria-pressed="' + (score === i) + '">' + i + '</button>';
    var list = score == null ? [] : (score >= 9 ? GOOD : BAD);
    box.innerHTML =
      '<div class="nps2-e">Votre avis sur Docline</div><div class="nps2-q" id="nps2-title">' + q + '</div>' +
      '<div class="nps2-scale" role="group" aria-labelledby="nps2-title">' + scale + '</div>' +
      '<div class="nps2-l"><span>Pas du tout</span><span>Tout à fait</span></div>' +
      (score != null ? '<div class="nps2-q2">' + (score >= 9 ? 'Qu’appréciez-vous le plus ?' : 'Que devrions-nous améliorer en priorité ?') + '</div>' +
        '<div class="nps2-chips">' + list.map(function (r) {
          return '<button type="button" data-r="' + r[0] + '" class="' + (reasons[r[0]] ? 'on' : '') + '" aria-pressed="' + !!reasons[r[0]] + '">' + r[1] + '</button>';
        }).join('') + '</div>' +
        '<textarea id="nps2-c" maxlength="600" placeholder="Dites-nous en plus (facultatif)"></textarea>' : '') +
      '<div class="nps2-a"><button type="button" class="nps2-later" data-later>Plus tard</button>' +
      '<button type="button" class="nps2-send" data-send' + (score == null ? ' disabled' : '') + '>Envoyer</button></div>';
  }

  function close(ov) { ov.classList.remove('on'); setTimeout(function () { ov.remove(); }, 450); }

  function open() {
    css();
    var ov = document.createElement('div');
    ov.className = 'nps2'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'nps2-title');
    var box = document.createElement('div'); box.className = 'nps2-s';
    ov.appendChild(box); document.body.appendChild(ov);
    render(box);
    requestAnimationFrame(function () { ov.classList.add('on'); });
    try { sessionStorage.setItem('dl_nps_seen', '1'); } catch (e) {}

    box.addEventListener('click', async function (e) {
      var s = e.target.closest('[data-s]');
      if (s) { var keep = (box.querySelector('#nps2-c') || {}).value || ''; score = +s.dataset.s; reasons = {}; render(box); var t = box.querySelector('#nps2-c'); if (t) t.value = keep; return; }
      var r = e.target.closest('[data-r]');
      if (r) { reasons[r.dataset.r] = !reasons[r.dataset.r]; r.classList.toggle('on'); r.setAttribute('aria-pressed', !!reasons[r.dataset.r]); return; }
      if (e.target.closest('[data-later]')) { sb.rpc('nps_dismiss'); close(ov); return; }
      var b = e.target.closest('[data-send]');
      if (b && score != null) {
        b.disabled = true; b.textContent = 'Envoi…';
        await sb.rpc('nps_submit', { p_score: score, p_reasons: Object.keys(reasons).filter(function (k) { return reasons[k]; }),
          p_comment: ((box.querySelector('#nps2-c') || {}).value || '').trim() || null });
        box.innerHTML = '<div class="nps2-done"><div class="nps2-ok"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></div>' +
          '<div class="nps2-q">Merci</div><p style="font-size:13.5px;color:#5B4F78;margin-top:6px;line-height:1.5">Chaque réponse est lue par l’équipe Docline.</p></div>';
        setTimeout(function () { close(ov); }, 2200);
      }
    });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { sb.rpc('nps_dismiss'); close(ov); document.removeEventListener('keydown', onKey); } });
  }

  sb.rpc('nps_should_ask').then(function (r) {
    if (!r || r.error || !r.data || !r.data.ask) return;
    segment = r.data.segment || 'doctor';
    open();
  });
})();
