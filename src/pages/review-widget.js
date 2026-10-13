/* Docline · avis du patient après une consultation vérifiée
 * ReviewWidget.mount(el, { supa, kind: 'queue'|'appointment', ref, secret, onState(state) })
 * 1. Trois questions oui/non (écouté, traitement expliqué, recommanderait).
 * 2. Un mot facultatif, lu par le médecin seul (jamais publié).
 * 3. Satisfaction envers Docline (0 à 10), facultative.
 * Le serveur vérifie que la consultation a bien eu lieu ; un avis par passage.
 */
(function () {
  var QUESTIONS = [
    ['listened', 'Vous êtes-vous senti écouté ?'],
    ['explained', 'Votre traitement vous a-t-il été bien expliqué ?'],
    ['recommend', 'Recommanderiez-vous ce médecin à un proche ?']
  ];
  var NPS_REASONS_GOOD = [['suivi_file', 'Suivre la file sur mon téléphone'], ['moins_attente', 'Moins d’attente sur place'], ['reservation', 'Réserver en ligne'], ['rappels', 'Les rappels'], ['simplicite', 'C’est simple']];
  var NPS_REASONS_BAD = [['lenteur', 'C’est lent'], ['bugs', 'Quelque chose ne marche pas'], ['infos_medecin', 'Il manque des informations sur le médecin'], ['reservation', 'Réserver est compliqué'], ['suivi_file', 'Le suivi de la file']];
  var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  var CLOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  var LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function frDay(iso) { if (!iso) return ''; return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); }

  function mount(el, opts) {
    var ctx = null, answers = {}, note = '', signed = false, busy = false, step = 'ask', nps = null, reasons = {};
    el.classList.add('rw');
    function state(s) { if (opts.onState) opts.onState(s); }
    function shell(html) { el.hidden = false; el.innerHTML = html; }
    function first() { return ctx && ctx.author_label ? String(ctx.author_label).split(' ')[0] : ''; }

    function renderAsk() {
      var done = QUESTIONS.every(function (q) { return answers[q[0]] != null; });
      shell(
        '<div class="rw-eyebrow">Consultation vérifiée</div>' +
        '<div class="rw-title">Comment s’est passée votre consultation avec ' + esc(ctx.doctor_name) + ' ?</div>' +
        '<div class="rw-facts"><span class="rw-fact">' + CHECK + 'Passage du ' + esc(frDay(ctx.visit_date)) + '</span>' +
          (ctx.wait_minutes != null ? '<span class="rw-fact">' + CLOCK + 'Attente mesurée : ' + ctx.wait_minutes + ' min</span>' : '') + '</div>' +
        '<div class="rw-qs">' + QUESTIONS.map(function (q) {
          var v = answers[q[0]];
          return '<div class="rw-q"><span>' + q[1] + '</span><div class="rw-yn" role="group" aria-label="' + esc(q[1]) + '">' +
            '<button type="button" data-q="' + q[0] + '" data-v="1" class="' + (v === true ? 'on yes' : '') + '" aria-pressed="' + (v === true) + '">Oui</button>' +
            '<button type="button" data-q="' + q[0] + '" data-v="0" class="' + (v === false ? 'on no' : '') + '" aria-pressed="' + (v === false) + '">Non</button></div></div>';
        }).join('') + '</div>' +
        (done ?
          '<label class="rw-lbl" for="rw-note">Un mot pour le médecin <span>(facultatif)</span></label>' +
          '<textarea id="rw-note" class="rw-text" maxlength="400" rows="3" placeholder="Merci docteur…">' + esc(note) + '</textarea>' +
          '<div class="rw-private">' + LOCK + 'Lu par le médecin seul. Jamais publié.</div>' +
          (ctx.author_label ? '<label class="rw-anon"><input type="checkbox" id="rw-signed"' + (signed ? ' checked' : '') + '> Signer avec mon prénom <span>(' + esc(ctx.author_label) + ')</span></label>' : '') +
          '<button type="button" class="rw-send" id="rw-send">Envoyer</button>' +
          '<div class="rw-err" id="rw-err" role="alert"></div>'
        : '<p class="rw-hint">Vos réponses comptent dans les indicateurs vérifiés du médecin, sans votre nom.</p>'));
    }

    function renderNps() {
      var scale = '';
      for (var i = 0; i <= 10; i++) scale += '<button type="button" data-nps="' + i + '" class="' + (nps === i ? 'on' : '') + '" aria-pressed="' + (nps === i) + '">' + i + '</button>';
      var list = nps == null ? [] : (nps >= 9 ? NPS_REASONS_GOOD : NPS_REASONS_BAD);
      shell(
        '<div class="rw-done-ic small">' + CHECK + '</div>' +
        '<div class="rw-title">Merci' + (first() ? ', ' + esc(first()) : '') + '</div>' +
        '<p class="rw-sub">Vos réponses sont enregistrées.</p>' +
        '<div class="rw-sep"></div>' +
        '<div class="rw-eyebrow">Une dernière question</div>' +
        '<div class="rw-title sm">Recommanderiez-vous Docline à un proche ?</div>' +
        '<div class="rw-scale" role="group" aria-label="De 0 à 10">' + scale + '</div>' +
        '<div class="rw-scale-l"><span>Pas du tout</span><span>Tout à fait</span></div>' +
        (nps != null ?
          '<div class="rw-q2">' + (nps >= 9 ? 'Qu’est-ce qui vous a le plus aidé ?' : 'Que devrions-nous améliorer ?') + '</div>' +
          '<div class="rw-chips">' + list.map(function (r) {
            return '<button type="button" class="rw-chip' + (reasons[r[0]] ? ' on' : '') + '" data-reason="' + r[0] + '" aria-pressed="' + !!reasons[r[0]] + '">' + r[1] + '</button>';
          }).join('') + '</div>' +
          '<button type="button" class="rw-send" id="rw-nps-send">Envoyer</button>' : '') +
        '<button type="button" class="rw-skip" id="rw-skip">Passer</button>');
    }

    function renderFinal() {
      shell('<div class="rw-done"><div class="rw-done-ic">' + CHECK + '</div><div class="rw-title">Merci' + (first() ? ', ' + esc(first()) : '') + '</div>' +
        '<p class="rw-sub">Bonne santé. Vos réponses aident les prochains patients à choisir et à venir au bon moment.</p></div>');
      state('done');
    }

    function renderInfo(title, text) {
      shell('<div class="rw-done"><div class="rw-done-ic">' + CHECK + '</div><div class="rw-title">' + esc(title) + '</div><p class="rw-sub">' + esc(text) + '</p></div>');
    }

    el.addEventListener('input', function (e) { if (e.target.id === 'rw-note') note = e.target.value; });
    el.addEventListener('change', function (e) { if (e.target.id === 'rw-signed') signed = e.target.checked; });
    el.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-q]');
      if (b) {
        answers[b.dataset.q] = b.dataset.v === '1';
        if (navigator.vibrate) navigator.vibrate(8);
        renderAsk();
        var next = el.querySelector('#rw-note'); if (next && QUESTIONS.every(function (q) { return answers[q[0]] != null; }) && b.dataset.q === 'recommend') next.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (e.target.closest('#rw-send')) { submit(); return; }
      var n = e.target.closest('[data-nps]');
      if (n) { nps = +n.dataset.nps; reasons = {}; renderNps(); return; }
      var rs = e.target.closest('[data-reason]');
      if (rs) { reasons[rs.dataset.reason] = !reasons[rs.dataset.reason]; rs.classList.toggle('on'); rs.setAttribute('aria-pressed', !!reasons[rs.dataset.reason]); return; }
      if (e.target.closest('#rw-nps-send')) {
        e.target.closest('#rw-nps-send').disabled = true;
        await opts.supa.rpc('nps_submit_patient', { p_kind: opts.kind, p_ref: String(opts.ref), p_secret: String(opts.secret), p_score: nps,
          p_reasons: Object.keys(reasons).filter(function (k) { return reasons[k]; }), p_comment: null });
        renderFinal(); return;
      }
      if (e.target.closest('#rw-skip')) { renderFinal(); return; }
    });

    async function submit() {
      if (busy) return;
      busy = true;
      var btn = el.querySelector('#rw-send'); btn.disabled = true; btn.textContent = 'Envoi…';
      var r = await opts.supa.rpc('review_submit_v2', {
        p_kind: opts.kind, p_ref: String(opts.ref), p_secret: String(opts.secret),
        p_listened: answers.listened, p_explained: answers.explained, p_recommend: answers.recommend,
        p_note: note.trim() || null, p_signed: signed
      });
      busy = false;
      if (r.error) {
        if ((r.error.message || '').indexOf('REVIEW_ALREADY') !== -1) { renderInfo('Déjà enregistré', 'Vous avez déjà répondu pour cette consultation. Merci !'); return; }
        btn.disabled = false; btn.textContent = 'Envoyer';
        el.querySelector('#rw-err').textContent = 'L’envoi n’a pas abouti. Vérifiez votre connexion et réessayez.';
        return;
      }
      step = 'nps'; renderNps(); state('answered');
    }

    async function load() {
      var r = await opts.supa.rpc('review_context', { p_kind: opts.kind, p_ref: String(opts.ref), p_secret: String(opts.secret) });
      ctx = r.data;
      if (r.error || !ctx) { el.hidden = true; state('error'); return; }
      if (ctx.eligible) { renderAsk(); state('open'); return; }
      if (ctx.reason === 'already') { renderInfo('Merci pour vos réponses', 'Vous avez déjà répondu pour cette consultation.'); state('already'); return; }
      el.hidden = true; state(ctx.reason || 'closed');
    }

    el.hidden = true;
    load();
    return { reload: load };
  }

  window.ReviewWidget = { mount: mount };
})();
