/* Docline · avis patient vérifié
 * ReviewWidget.mount(el, { supa, kind: 'queue'|'appointment', ref, secret, onState(state) })
 * Le serveur vérifie que la consultation a bien eu lieu (review_context) ;
 * l'avis n'est possible qu'une fois par passage.
 */
(function () {
  var POS = [['ecoute', 'À l’écoute'], ['explications', 'Explications claires'], ['confiance', 'Inspire confiance'],
             ['accueil', 'Accueil chaleureux'], ['ponctualite', 'Ponctuel'], ['rapidite', 'Prise en charge rapide'], ['cabinet', 'Cabinet agréable']];
  var NEG = [['attente', 'Attente longue'], ['explications_insuffisantes', 'Explications insuffisantes'],
             ['accueil_ameliorer', 'Accueil à améliorer'], ['tarif_flou', 'Tarif peu clair']];
  var WORDS = ['', 'Décevante', 'Moyenne', 'Correcte', 'Très bien', 'Excellente'];
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.83 5.73 6.32.92-4.57 4.46 1.08 6.3L12 17.24l-5.66 2.97 1.08-6.3-4.57-4.46 6.32-.92z"/></svg>';
  var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  var CLOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function frDay(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  }

  function mount(el, opts) {
    var ctx = null, rating = 0, tags = {}, busy = false;
    el.classList.add('rw');

    function state(s) { if (opts.onState) opts.onState(s); }

    function shell(inner) { el.hidden = false; el.innerHTML = inner; }

    function renderDone(pending, name) {
      shell('<div class="rw-done"><div class="rw-done-ic">' + CHECK + '</div>' +
        '<div class="rw-title">Merci' + (name ? ', ' + esc(name.split(' ')[0]) : '') + '</div>' +
        '<p class="rw-sub">' + (pending ? 'Votre note est publiée. Votre commentaire le sera après relecture par notre équipe.' : 'Votre avis est publié. Il aidera les prochains patients à choisir.') + '</p></div>');
      state('done');
    }

    function chips() {
      var list = rating >= 4 ? POS : NEG.concat(POS.slice(0, 3));
      return '<div class="rw-q">' + (rating >= 4 ? 'Qu’avez-vous apprécié ?' : 'Qu’est-ce qui pourrait être mieux ?') + '</div>' +
        '<div class="rw-chips">' + list.map(function (t) {
          return '<button type="button" class="rw-chip' + (tags[t[0]] ? ' on' : '') + '" data-tag="' + t[0] + '" aria-pressed="' + !!tags[t[0]] + '">' + t[1] + '</button>';
        }).join('') + '</div>';
    }

    function render() {
      var stars = '';
      for (var i = 1; i <= 5; i++) stars += '<button type="button" class="rw-star' + (i <= rating ? ' on' : '') + '" data-star="' + i + '" aria-label="' + i + ' sur 5 : ' + WORDS[i] + '">' + STAR + '</button>';
      shell(
        '<div class="rw-eyebrow">Votre avis · consultation vérifiée</div>' +
        '<div class="rw-title">Comment s’est passée votre consultation avec ' + esc(ctx.doctor_name) + ' ?</div>' +
        '<div class="rw-facts"><span class="rw-fact">' + CHECK + 'Passage du ' + esc(frDay(ctx.visit_date)) + '</span>' +
          (ctx.wait_minutes != null ? '<span class="rw-fact">' + CLOCK + 'Attente mesurée : ' + ctx.wait_minutes + ' min</span>' : '') + '</div>' +
        '<div class="rw-stars" role="radiogroup" aria-label="Votre note">' + stars + '</div>' +
        '<div class="rw-word" aria-live="polite">' + (rating ? WORDS[rating] : 'Touchez une étoile') + '</div>' +
        (rating ? chips() +
          '<label class="rw-lbl" for="rw-comment">Un mot pour les prochains patients <span>(facultatif)</span></label>' +
          '<textarea id="rw-comment" class="rw-text" maxlength="600" rows="3" placeholder="Ce qui vous a aidé, ce qui pourrait être mieux">' + esc(el._draft || '') + '</textarea>' +
          '<div class="rw-hint">Relu par notre équipe avant publication. N’indiquez pas d’information médicale ni de nom.</div>' +
          '<label class="rw-anon"><input type="checkbox" id="rw-anon"' + (el._anon ? ' checked' : '') + '> Publier sans mon prénom' + (ctx.author_label ? ' <span>(sinon : ' + esc(ctx.author_label) + ')</span>' : '') + '</label>' +
          '<button type="button" class="rw-send" id="rw-send">Publier mon avis</button>' +
          '<div class="rw-err" id="rw-err" role="alert"></div>' : ''));
    }

    el.addEventListener('click', function (e) {
      var s = e.target.closest('[data-star]');
      if (s) {
        var t = el.querySelector('#rw-comment'); if (t) el._draft = t.value;
        var a = el.querySelector('#rw-anon'); if (a) el._anon = a.checked;
        var before = rating >= 4;
        rating = +s.dataset.star;
        if ((rating >= 4) !== before) tags = {};
        if (navigator.vibrate) navigator.vibrate(8);
        render();
        var b = el.querySelector('[data-star="' + rating + '"]'); if (b) { b.classList.add('pop'); b.focus(); }
        return;
      }
      var c = e.target.closest('[data-tag]');
      if (c) { tags[c.dataset.tag] = !tags[c.dataset.tag]; c.classList.toggle('on'); c.setAttribute('aria-pressed', !!tags[c.dataset.tag]); return; }
      if (e.target.closest('#rw-send')) submit();
    });

    async function submit() {
      if (busy || !rating) return;
      busy = true;
      var btn = el.querySelector('#rw-send'); btn.disabled = true; btn.textContent = 'Publication…';
      var txt = (el.querySelector('#rw-comment') || {}).value || '';
      var r = await opts.supa.rpc('review_submit', {
        p_kind: opts.kind, p_ref: String(opts.ref), p_secret: String(opts.secret), p_rating: rating,
        p_tags: Object.keys(tags).filter(function (k) { return tags[k]; }), p_comment: txt.trim() || null,
        p_anonymous: !!(el.querySelector('#rw-anon') || {}).checked
      });
      busy = false;
      if (r.error) {
        var m = r.error.message || '';
        if (m.indexOf('REVIEW_ALREADY') !== -1) { renderInfo('Avis déjà enregistré', 'Vous avez déjà donné votre avis pour cette consultation. Merci !'); return; }
        btn.disabled = false; btn.textContent = 'Publier mon avis';
        el.querySelector('#rw-err').textContent = 'L’avis n’a pas pu être envoyé. Vérifiez votre connexion et réessayez.';
        return;
      }
      renderDone(r.data && r.data.comment_pending, ctx.author_label);
    }

    function renderInfo(title, text) {
      shell('<div class="rw-done"><div class="rw-done-ic">' + CHECK + '</div><div class="rw-title">' + esc(title) + '</div><p class="rw-sub">' + esc(text) + '</p></div>');
    }

    async function load() {
      var r = await opts.supa.rpc('review_context', { p_kind: opts.kind, p_ref: String(opts.ref), p_secret: String(opts.secret) });
      ctx = r.data;
      if (r.error || !ctx) { el.hidden = true; state('error'); return; }
      if (ctx.eligible) { render(); state('open'); return; }
      if (ctx.reason === 'already') { renderInfo('Merci pour votre avis', 'Vous avez déjà donné votre avis pour cette consultation.'); state('already'); return; }
      el.hidden = true; state(ctx.reason || 'closed');
    }

    el.hidden = true;
    load();
    return { reload: load };
  }

  window.ReviewWidget = { mount: mount };
})();
