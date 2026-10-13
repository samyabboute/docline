/* Docline · sélecteur de médicaments
 * Recherche dans la nomenclature nationale (table drugs, fonction drug_search).
 * DrugPicker.attach(input, { supa, value, onChange(drug|null), fallback: [noms], favorites: () => [drugs] })
 *   favorites : médicaments que le médecin prescrit le plus, proposés dès que le champ est vide
 * Le médicament choisi est rattaché à sa fiche officielle ; si le médecin modifie
 * le texte ensuite, le rattachement est retiré et la saisie reste libre.
 */
(function () {
  var cache = {};
  var SOURCE = 'Nomenclature nationale · août 2026';

  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function cap(s) { s = String(s || '').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  function label(d) {
    return [d.brand, d.dosage].filter(Boolean).join(' ') + (d.form ? ' · ' + cap(d.form) : '');
  }
  function toLink(d) {
    return { drug_id: d.id, brand: d.brand, dci: d.dci, dci_code: d.dci_code, form: d.form, dosage: d.dosage,
             list: d.list, pharmacy: d.pharmacy, hospital: d.hospital };
  }
  function chips(d) {
    var c = [];
    if (d.list === 'STUPEFIANT') c.push('<span class="dp-chip dp-red">Stupéfiant</span>');
    else if (d.list) c.push('<span class="dp-chip">Liste ' + d.list + '</span>');
    if (d.hospital && !d.pharmacy) c.push('<span class="dp-chip dp-amber">Hôpital uniquement</span>');
    return c.join('');
  }
  function sub(d) {
    var p = [];
    if (d.form) p.push(cap(d.form));
    if (d.product_type === 'GE') p.push('Générique');
    else if (d.product_type === 'RE') p.push('Princeps');
    else if (d.product_type === 'BIO') p.push('Biologique');
    if (d.origin === 'F') p.push('Fabriqué en Algérie');
    p.push(cap(d.dci));
        return p.join(' · ');
  }
  function mark(text, q) {
    var t = esc(text); if (!q) return t;
    var i = fold(text).indexOf(fold(q));
    if (i < 0) return t;
    var raw = String(text);
    return esc(raw.slice(0, i)) + '<mark>' + esc(raw.slice(i, i + q.length)) + '</mark>' + esc(raw.slice(i + q.length));
  }

  function attach(inp, opts) {
    opts = opts || {};
    var wrap = inp.parentNode;
    wrap.classList.add('dp-wrap');
    var drop = document.createElement('div'); drop.className = 'dp-drop'; drop.hidden = true;
    drop.setAttribute('role', 'listbox');
    var meta = document.createElement('div'); meta.className = 'dp-meta';
    wrap.appendChild(drop); wrap.appendChild(meta);
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('role', 'combobox');
    inp.setAttribute('aria-expanded', 'false');

    var linked = opts.value && opts.value.drug_id ? opts.value : null;
    var results = [], hi = -1, timer = null, seq = 0;

    function paintMeta() {
      wrap.classList.toggle('dp-linked', !!linked);
      if (!linked) { meta.innerHTML = ''; return; }
      var bits = ['<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>', esc(cap(linked.dci))];
      if (linked.list === 'STUPEFIANT') bits.push('<span class="dp-chip dp-red">Stupéfiant</span>');
      else if (linked.list) bits.push('<span class="dp-chip">Liste ' + linked.list + '</span>');
      if (linked.hospital && !linked.pharmacy) bits.push('<span class="dp-chip dp-amber">Hôpital uniquement</span>');
      meta.innerHTML = bits.join(' ');
    }
    function setLinked(d) {
      linked = d;
      paintMeta();
      if (opts.onChange) opts.onChange(linked);
    }
    function close() { drop.hidden = true; hi = -1; inp.setAttribute('aria-expanded', 'false'); }
    function setHi(i) {
      var items = drop.querySelectorAll('.dp-item');
      if (!items.length) return;
      hi = (i + items.length) % items.length;
      items.forEach(function (el, k) { el.classList.toggle('hi', k === hi); });
      items[hi].scrollIntoView({ block: 'nearest' });
    }
    function pick(i) {
      var d = results[i]; if (!d) return;
      if (d._free) { inp.value = d.name; setLinked(null); close(); return; }
      inp.value = label(d);
      setLinked(toLink(d));
      close();
    }
    function render(q, list, failed, title) {
      results = list;
      if (!list.length) {
        drop.innerHTML = '<div class="dp-empty">' + (failed ? 'Catalogue indisponible pour le moment. La saisie libre reste possible.'
          : 'Aucun médicament en vigueur ne correspond. Vous pouvez garder votre saisie.') + '</div>';
      } else {
        drop.innerHTML = '<div class="dp-head' + (title ? ' dp-head-fav' : '') + '">' + (title || (failed ? 'Suggestions hors ligne' : SOURCE)) + '</div>' + list.map(function (d, i) {
          if (d._free) return '<div class="dp-item" role="option" data-i="' + i + '"><div class="dp-l1"><span class="dp-brand">' + mark(d.name, q) + '</span></div></div>';
          return '<div class="dp-item" role="option" data-i="' + i + '">' +
            '<div class="dp-l1"><span class="dp-brand">' + mark(d.brand, q) + '</span>' +
            (d.dosage ? '<span class="dp-dose">' + esc(d.dosage) + '</span>' : '') +
            '<span class="dp-chips">' + chips(d) + '</span></div>' +
            '<div class="dp-l2">' + mark(sub(d), q) + '</div></div>';
        }).join('');
      }
      hi = -1;
      drop.hidden = false;
      inp.setAttribute('aria-expanded', 'true');
    }
    function search(q) {
      var key = fold(q).trim();
      if (!key.length) { showFavorites(); return; }
      if (key.length < 2) { close(); return; }
      if (cache[key]) { render(q, cache[key]); return; }
      var my = ++seq;
      var p = opts.supa ? opts.supa.rpc('drug_search', { p_q: q, p_limit: 12 }) : Promise.resolve({ error: true });
      Promise.resolve(p).then(function (r) {
        if (my !== seq) return;
        if (r.error) {
          var fb = (opts.fallback || []).filter(function (n) { return fold(n).indexOf(key) >= 0; }).slice(0, 8)
            .map(function (n) { return { _free: true, name: n }; });
          render(q, fb, true); return;
        }
        cache[key] = r.data || [];
        render(q, cache[key]);
      }).catch(function () { if (my === seq) render(q, [], true); });
    }

    inp.addEventListener('input', function () {
      if (linked) setLinked(null);
      clearTimeout(timer);
      var q = inp.value;
      timer = setTimeout(function () { search(q); }, 140);
    });
    function showFavorites() {
      var fav = opts.favorites ? (opts.favorites() || []) : [];
      if (!fav.length) return;
      render('', fav.slice(0, 8), false, 'Vos prescriptions fréquentes');
    }
    inp.addEventListener('focus', function () {
      if (!linked && inp.value.trim().length >= 2) search(inp.value);
      else if (!inp.value.trim()) showFavorites();
    });
    inp.addEventListener('keydown', function (e) {
      if (drop.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi(hi + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(hi - 1); }
      else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); pick(hi); }
      else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
    drop.addEventListener('mousedown', function (e) {
      var it = e.target.closest('.dp-item');
      if (it) { e.preventDefault(); pick(+it.dataset.i); }
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });

    paintMeta();
    return {
      get: function () { return linked; },
      // Remplacement depuis une alternative proposée : même rendu qu'un choix dans la liste
      set: function (d) { inp.value = label(d); close(); setLinked(toLink(d)); }
    };
  }

  window.DrugPicker = { attach: attach, label: label };
})();
