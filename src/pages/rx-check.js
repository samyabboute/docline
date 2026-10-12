/* Docline · vérification de l'ordonnance (interactions et doublons)
 * RxCheck.mount(el, { supa, getDrugs: () => [{ drug_id, label }] })
 *   refresh()        relance la vérification (avec un court délai)
 *   reset(acks)      vide les alertes ; acks = confirmations déjà enregistrées
 *   settle()         promesse résolue quand la dernière vérification est terminée
 *   blocking()       nombre d'alertes graves non confirmées par le médecin
 *   acks()           confirmations à enregistrer avec l'ordonnance
 *   focus()          amène le panneau à l'écran
 * Les alertes n'apparaissent que si elles sont validées par le pharmacien et
 * mises en service (contrôlé par la base, fonction prescription_check).
 */
(function () {
  var LEVELS = {
    contre_indication: { l: 'Contre-indication', c: 'rx-ci', sev: 1 },
    association_deconseillee: { l: 'Association déconseillée', c: 'rx-ad', sev: 2 },
    doublon: { l: 'Même molécule deux fois', c: 'rx-dup', sev: 3 },
    precaution_emploi: { l: 'Précaution d’emploi', c: 'rx-pe', sev: 4 },
    a_prendre_en_compte: { l: 'À prendre en compte', c: 'rx-apc', sev: 5 }
  };
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function isSevere(level) { return level === 'contre_indication' || level === 'association_deconseillee'; }

  function mount(el, opts) {
    var results = [], names = {}, acked = {}, lastKey = '', timer = null, seq = 0, pending = Promise.resolve();
    el.classList.add('rx');
    el.hidden = true;
    el.setAttribute('aria-live', 'polite');

    function keyOf(r) { return r.level + ':' + r.drug_a + ':' + r.drug_b; }

    function render() {
      if (!results.length) { el.hidden = true; el.innerHTML = ''; return; }
      var severe = results.filter(function (r) { return isSevere(r.level); }).length;
      el.hidden = false;
      el.innerHTML =
        '<div class="rx-head"><span class="rx-ic' + (severe ? ' sev' : '') + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg></span>' +
        '<div><div class="rx-title">Vérification de l’ordonnance</div><div class="rx-sum">' +
        results.length + ' point' + (results.length > 1 ? 's' : '') + ' à vérifier' + (severe ? ', dont ' + severe + ' important' + (severe > 1 ? 's' : '') : '') + '</div></div></div>' +
        results.map(function (r, i) {
          var L = LEVELS[r.level] || { l: r.level, c: '' };
          var a = names[r.drug_a] || 'Médicament', b = names[r.drug_b] || 'Médicament';
          var what = r.level === 'doublon'
            ? '<b>' + esc(a) + '</b> et <b>' + esc(b) + '</b> contiennent tous deux ' + esc(r.substance_a) + '.'
            : '<b>' + esc(a) + '</b> et <b>' + esc(b) + '</b>' + (r.substance_a ? ' <span class="rx-sub">(' + esc(cap(r.substance_a)) + ' + ' + esc(r.substance_b) + ')</span>' : '');
          return '<div class="rx-item ' + L.c + '">' +
            '<div class="rx-l1"><span class="rx-lv">' + L.l + '</span>' + (r.reviewed === false ? '<span class="rx-draft">Non validé</span>' : '') + '</div>' +
            '<div class="rx-what">' + what + '</div>' +
            (r.mechanism ? '<div class="rx-txt"><b>Risque.</b> ' + esc(r.mechanism) + '</div>' : '') +
            (r.conduct ? '<div class="rx-txt"><b>Conduite à tenir.</b> ' + esc(r.conduct) + '</div>' : '') +
            (r.source ? '<div class="rx-src">Source : ' + esc(r.source) + (r.source_version ? ', ' + esc(r.source_version) : '') + '</div>' : '') +
            (isSevere(r.level) ? '<label class="rx-ack"><input type="checkbox" data-ack="' + i + '"' + (acked[keyOf(r)] ? ' checked' : '') + '> Je maintiens cette association en connaissance de cause</label>' : '') +
            '</div>';
        }).join('');
    }

    el.addEventListener('change', function (e) {
      var cb = e.target.closest('[data-ack]'); if (!cb) return;
      var r = results[+cb.dataset.ack]; if (!r) return;
      var k = keyOf(r);
      if (cb.checked) acked[k] = { level: r.level, drug_a: r.drug_a, drug_b: r.drug_b, label_a: names[r.drug_a] || null, label_b: names[r.drug_b] || null,
                                   substances: [r.substance_a, r.substance_b], source: r.source || null, at: new Date().toISOString() };
      else delete acked[k];
      el.classList.remove('rx-need');
    });

    function run() {
      var drugs = (opts.getDrugs() || []).filter(function (d) { return d && d.drug_id; });
      names = {}; drugs.forEach(function (d) { names[d.drug_id] = d.label; });
      var ids = Object.keys(names).map(Number).sort(function (x, y) { return x - y; });
      var key = ids.join(',');
      if (ids.length < 2) { lastKey = key; results = []; render(); return Promise.resolve(); }
      if (key === lastKey) { render(); return Promise.resolve(); }
      var my = ++seq;
      return Promise.resolve(opts.supa.rpc('prescription_check', { p_drug_ids: ids })).then(function (r) {
        if (my !== seq) return;
        lastKey = key;
        // En cas d'erreur, l'ordonnance reste utilisable : la vérification est une aide
        if (r.error) { console.warn('[RxCheck]', r.error.message); results = []; }
        else results = r.data || [];
        render();
      }).catch(function (e) { if (my === seq) { console.warn('[RxCheck]', e); results = []; render(); } });
    }

    return {
      refresh: function () {
        clearTimeout(timer);
        pending = new Promise(function (resolve) { timer = setTimeout(function () { run().then(resolve, resolve); }, 250); });
      },
      reset: function (acks) {
        clearTimeout(timer); seq++; results = []; lastKey = ''; acked = {};
        (acks || []).forEach(function (a) { if (a && a.level) acked[a.level + ':' + a.drug_a + ':' + a.drug_b] = a; });
        pending = Promise.resolve(); render();
      },
      settle: function () { clearTimeout(timer); pending = run(); return pending; },
      blocking: function () { return results.filter(function (r) { return isSevere(r.level) && !acked[keyOf(r)]; }).length; },
      acks: function () {
        var live = {}; results.forEach(function (r) { live[keyOf(r)] = true; });
        return Object.keys(acked).filter(function (k) { return live[k]; }).map(function (k) { return acked[k]; });
      },
      focus: function () { el.classList.add('rx-need'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    };
  }

  window.RxCheck = { mount: mount };
})();
