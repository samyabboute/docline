/* Docline · vérification de l'ordonnance (interactions, doublons, allergies, situations du patient)
 * RxCheck.mount(el, { supa, getDrugs: () => [{ drug_id, label }], getClient: () => clientId|null,
 *                     replace: (oldDrugId, newDrug) => void, contextVersion: () => string })
 *   refresh()        relance la vérification (avec un court délai)
 *   reset(acks)      vide les alertes ; acks = confirmations déjà enregistrées
 *   settle()         promesse résolue quand la dernière vérification est terminée
 *   blocking()       nombre d'alertes graves non confirmées par le médecin
 *   acks()           confirmations à enregistrer avec l'ordonnance
 *   focus()          amène le panneau à l'écran
 * Les interactions et les situations n'apparaissent que validées par le pharmacien et
 * mises en service ; une allergie notée dans le dossier est toujours signalée.
 */
(function () {
  var LEVELS = {
    contre_indication: { l: 'Contre-indication', c: 'rx-ci', sev: 1 },
    association_deconseillee: { l: 'Association déconseillée', c: 'rx-ad', sev: 2 },
    doublon: { l: 'Même molécule deux fois', c: 'rx-dup', sev: 3 },
    precaution_emploi: { l: 'Précaution d’emploi', c: 'rx-pe', sev: 4 },
    a_prendre_en_compte: { l: 'À prendre en compte', c: 'rx-apc', sev: 5 }
  };
  var CONDITIONS = { grossesse: 'Grossesse', allaitement: 'Allaitement', insuffisance_renale_moderee: 'Insuffisance rénale',
    insuffisance_renale_severe: 'Insuffisance rénale sévère', insuffisance_hepatique: 'Insuffisance hépatique', enfant: 'Enfant', sujet_age: 'Sujet âgé' };
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }
  function isSevere(level) { return level === 'contre_indication' || level === 'association_deconseillee'; }
  function kindOf(r) { return r.kind || (r.level === 'doublon' ? 'doublon' : 'interaction'); }
  function badge(r) {
    var k = kindOf(r);
    if (k === 'allergie') return r.level === 'contre_indication' ? 'Allergie' : 'Allergie croisée possible';
    if (k === 'situation') return (CONDITIONS[r.substance_b] || 'Situation du patient') + ' · ' + (LEVELS[r.level] || {}).l;
    return (LEVELS[r.level] || { l: r.level }).l;
  }
  function canReplace(r) { var k = kindOf(r); return k === 'doublon' || isSevere(r.level) || (k === 'allergie' && r.level === 'contre_indication'); }

  function mount(el, opts) {
    var results = [], names = {}, acked = {}, lastKey = '', timer = null, seq = 0, pending = Promise.resolve();
    var alt = null;   // { key, forId, rows, loading }
    el.classList.add('rx');
    el.hidden = true;
    el.setAttribute('aria-live', 'polite');

    function keyOf(r) { return kindOf(r) + ':' + r.level + ':' + r.drug_a + ':' + (r.drug_b || '') + ':' + (r.substance_b || ''); }
    function nameOf(id) { return names[id] || 'Médicament'; }

    function altBlock(r) {
      if (!alt || alt.key !== keyOf(r)) return '';
      if (alt.loading) return '<div class="rx-alts"><div class="rx-alts-h">Recherche d’alternatives…</div></div>';
      var h = '<div class="rx-alts"><div class="rx-alts-h">Remplacer ' + esc(nameOf(alt.forId)) + ' par</div>';
      if (!alt.rows.length) {
        h += '<p class="rx-alts-none">' + (kindOf(r) === 'allergie'
          ? 'Aucune alternative proposée dans la même famille : l’allergie peut concerner toute la famille. Choisissez une molécule d’une autre classe.'
          : 'Aucune alternative de la même famille sans alerte avec cette ordonnance.') + '</p>';
      } else {
        h += alt.rows.map(function (x, i) {
          var d = x.drug;
          return '<button type="button" class="rx-alt" data-pick="' + i + '"><span class="rx-alt-m">' + esc(cap(x.molecule)) + '</span>' +
            '<span class="rx-alt-d">' + esc(d.brand) + (d.dosage ? ' ' + esc(d.dosage) : '') + (d.form ? ' · ' + esc(cap(d.form)) : '') +
            (x.brands > 1 ? ' · ' + x.brands + ' présentations' : '') + (d.origin === 'F' ? ' · Fabriqué en Algérie' : '') + '</span>' +
            (x.minor ? '<span class="rx-alt-w">Une précaution à lire après le choix</span>' : '<span class="rx-alt-ok">Sans alerte avec cette ordonnance</span>') + '</button>';
        }).join('');
        h += '<p class="rx-alts-note">Même famille thérapeutique, disponible en Algérie. Vérifiez la posologie après le remplacement.</p>';
      }
      return h + '</div>';
    }

    function render() {
      if (!results.length) { el.hidden = true; el.innerHTML = ''; return; }
      var severe = results.filter(function (r) { return isSevere(r.level); }).length;
      el.hidden = false;
      el.innerHTML =
        '<div class="rx-head"><span class="rx-ic' + (severe ? ' sev' : '') + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg></span>' +
        '<div><div class="rx-title">Vérification de l’ordonnance</div><div class="rx-sum">' +
        results.length + ' point' + (results.length > 1 ? 's' : '') + ' à vérifier' + (severe ? ', dont ' + severe + ' important' + (severe > 1 ? 's' : '') : '') + '</div></div></div>' +
        results.map(function (r, i) {
          var L = LEVELS[r.level] || { c: '' }, k = kindOf(r);
          var what;
          if (k === 'doublon') what = '<b>' + esc(nameOf(r.drug_a)) + '</b> et <b>' + esc(nameOf(r.drug_b)) + '</b> contiennent tous deux ' + esc(r.substance_a) + '.';
          else if (k === 'allergie' || k === 'situation') what = '<b>' + esc(nameOf(r.drug_a)) + '</b>';
          else what = '<b>' + esc(nameOf(r.drug_a)) + '</b> et <b>' + esc(nameOf(r.drug_b)) + '</b>' + (r.substance_a ? ' <span class="rx-sub">(' + esc(cap(r.substance_a)) + ' + ' + esc(String(r.substance_b || '').toLowerCase()) + ')</span>' : '');
          var swap = '';
          if (opts.replace && canReplace(r)) {
            var targets = (k === 'allergie' || k === 'situation') ? [r.drug_a] : [r.drug_a, r.drug_b];
            swap = '<div class="rx-swap">' + targets.map(function (id) {
              return '<button type="button" data-alt="' + i + '" data-for="' + id + '">Remplacer ' + esc(nameOf(id)) + '</button>';
            }).join('') + '</div>';
          }
          return '<div class="rx-item ' + L.c + (k === 'allergie' ? ' rx-allergy' : '') + '">' +
            '<div class="rx-l1"><span class="rx-lv">' + esc(badge(r)) + '</span>' + (r.reviewed === false ? '<span class="rx-draft">Non validé</span>' : '') + '</div>' +
            '<div class="rx-what">' + what + '</div>' +
            (r.mechanism ? '<div class="rx-txt">' + (k === 'interaction' ? '<b>Risque.</b> ' : '') + esc(r.mechanism) + '</div>' : '') +
            (r.conduct ? '<div class="rx-txt"><b>Conduite à tenir.</b> ' + esc(r.conduct) + '</div>' : '') +
            (r.source ? '<div class="rx-src">Source : ' + esc(r.source) + (r.source_version ? ', ' + esc(r.source_version) : '') + '</div>' : '') +
            swap + altBlock(r) +
            (isSevere(r.level) ? '<label class="rx-ack"><input type="checkbox" data-ack="' + i + '"' + (acked[keyOf(r)] ? ' checked' : '') + '> Je maintiens cette prescription en connaissance de cause</label>' : '') +
            '</div>';
        }).join('');
    }

    el.addEventListener('change', function (e) {
      var cb = e.target.closest('[data-ack]'); if (!cb) return;
      var r = results[+cb.dataset.ack]; if (!r) return;
      var k = keyOf(r);
      if (cb.checked) acked[k] = { kind: kindOf(r), level: r.level, drug_a: r.drug_a, drug_b: r.drug_b || null, label_a: names[r.drug_a] || null,
                                   label_b: r.drug_b ? names[r.drug_b] || null : null, substances: [r.substance_a, r.substance_b],
                                   source: r.source || null, at: new Date().toISOString() };
      else delete acked[k];
      el.classList.remove('rx-need');
    });

    el.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-alt]');
      if (b) {
        var r = results[+b.dataset.alt], forId = +b.dataset.for, key = keyOf(r);
        if (alt && alt.key === key && alt.forId === forId) { alt = null; render(); return; }
        alt = { key: key, forId: forId, rows: [], loading: true }; render();
        var ids = Object.keys(names).map(Number);
        var res = await opts.supa.rpc('prescription_alternatives', { p_drug_ids: ids, p_replace: forId, p_client: opts.getClient ? opts.getClient() : null, p_limit: 5 });
        if (!alt || alt.key !== key || alt.forId !== forId) return;
        alt.loading = false; alt.rows = (res && res.data) || []; render();
        return;
      }
      var p = e.target.closest('[data-pick]');
      if (p && alt && alt.rows[+p.dataset.pick]) {
        var choice = alt.rows[+p.dataset.pick].drug, old = alt.forId;
        alt = null;
        opts.replace(old, choice);
        lastKey = '';
        api.refresh();
      }
    });

    function run() {
      var drugs = (opts.getDrugs() || []).filter(function (d) { return d && d.drug_id; });
      var client = opts.getClient ? opts.getClient() : null;
      names = {}; drugs.forEach(function (d) { names[d.drug_id] = d.label; });
      var ids = Object.keys(names).map(Number).sort(function (x, y) { return x - y; });
      var key = ids.join(',') + '|' + (client || '') + '|' + (opts.contextVersion ? opts.contextVersion() : '');
      if (!ids.length || (ids.length < 2 && !client)) { lastKey = key; results = []; alt = null; render(); return Promise.resolve(); }
      if (key === lastKey) { render(); return Promise.resolve(); }
      var my = ++seq;
      return Promise.resolve(opts.supa.rpc('prescription_check_ctx', { p_drug_ids: ids, p_client: client || null })).then(function (r) {
        if (my !== seq) return;
        lastKey = key;
        // En cas d'erreur, l'ordonnance reste utilisable : la vérification est une aide
        if (r.error) { console.warn('[RxCheck]', r.error.message); results = []; }
        else results = (r.data || []).sort(function (a, b) {
          var sa = a.kind === 'allergie' && a.level === 'contre_indication' ? 0 : (LEVELS[a.level] || { sev: 9 }).sev;
          var sb = b.kind === 'allergie' && b.level === 'contre_indication' ? 0 : (LEVELS[b.level] || { sev: 9 }).sev;
          return sa - sb;
        });
        if (alt && !results.some(function (x) { return keyOf(x) === alt.key; })) alt = null;
        render();
      }).catch(function (e) { if (my === seq) { console.warn('[RxCheck]', e); results = []; render(); } });
    }

    var api = {
      refresh: function () {
        clearTimeout(timer);
        pending = new Promise(function (resolve) { timer = setTimeout(function () { run().then(resolve, resolve); }, 250); });
      },
      reset: function (acks) {
        clearTimeout(timer); seq++; results = []; lastKey = ''; acked = {}; alt = null;
        (acks || []).forEach(function (a) {
          if (a && a.level) acked[(a.kind || (a.level === 'doublon' ? 'doublon' : 'interaction')) + ':' + a.level + ':' + a.drug_a + ':' + (a.drug_b || '') + ':' + ((a.substances || [])[1] || '')] = a;
        });
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
    return api;
  }

  window.RxCheck = { mount: mount };
})();
