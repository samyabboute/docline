/* Docline · contexte clinique du patient pour la vérification d'ordonnance
 * PatientContext.mount(el, { supa, onChange })
 *   load(clientId)  charge le contexte d'un patient de la liste (ou masque le bloc)
 *   clientId()      patient en cours
 * Allergies structurées, grossesse ou allaitement, fonction rénale et hépatique.
 * L'âge vient de la date de naissance du dossier. Chaque changement est enregistré
 * aussitôt dans le dossier du patient (table patient_clinical_context).
 */
(function () {
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function age(iso) {
    if (!iso) return null;
    var b = new Date(iso + 'T12:00:00'), n = new Date(), a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a >= 0 && a < 130 ? a : null;
  }

  function mount(el, opts) {
    var cid = null, ctx = null, client = null, me = null, timer = null, seq = 0, open = false, current = [];
    el.classList.add('pc');
    el.hidden = true;

    function changed() { if (opts.onChange) opts.onChange(); }

    async function save() {
      if (!cid || !ctx) return;
      var r = await opts.supa.from('patient_clinical_context').upsert({
        client_id: cid, doctor_id: (client && client.user_id) || me, allergens: ctx.allergens, pregnancy: ctx.pregnancy,
        renal: ctx.renal, hepatic: ctx.hepatic, updated_at: new Date().toISOString()
      });
      el.querySelector('.pc-saved').textContent = r.error ? 'Non enregistré, réessayez' : 'Enregistré dans le dossier';
      el.querySelector('.pc-saved').classList.toggle('err', !!r.error);
    }

    function summary() {
      var p = [];
      var a = age(client && client.date_naissance);
      if (a != null) p.push(a + ' ans');
      if (ctx.pregnancy === 'pregnant') p.push('enceinte');
      if (ctx.pregnancy === 'breastfeeding') p.push('allaite');
      if (ctx.renal === 'moderate') p.push('insuffisance rénale modérée');
      if (ctx.renal === 'severe') p.push('insuffisance rénale sévère');
      if (ctx.hepatic === 'impaired') p.push('insuffisance hépatique');
      if (ctx.allergens.length) p.push(ctx.allergens.length + ' allergie' + (ctx.allergens.length > 1 ? 's' : ''));
      if (current.length) p.push(current.length + ' traitement' + (current.length > 1 ? 's' : '') + ' en cours');
      return p.length ? p.join(' · ') : 'Rien de particulier noté';
    }

    function seg(name, value, options) {
      return '<div class="pc-seg" data-field="' + name + '">' + options.map(function (o) {
        return '<button type="button" data-v="' + o[0] + '" class="' + (value === o[0] ? 'on' : '') + '" aria-pressed="' + (value === o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    }

    function render() {
      var showPreg = !client || client.sexe !== 'M';   // masqué seulement pour un homme
      el.hidden = false;
      el.innerHTML =
        '<button type="button" class="pc-head" aria-expanded="' + open + '">' +
          '<span class="pc-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>' +
          '<span class="pc-ht"><b>Contexte du patient</b><span>' + esc(summary()) + '</span></span>' +
          '<svg class="pc-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>' +
        '<div class="pc-body"' + (open ? '' : ' hidden') + '>' +
          '<div class="pc-row"><span class="pc-lbl">Allergies</span><div class="pc-allergies">' +
            ctx.allergens.map(function (a, i) {
              return '<span class="pc-chip">' + esc(a.label) + (a.kind === 'class' ? ' <small>famille</small>' : '') + '<button type="button" data-rm="' + i + '" aria-label="Retirer ' + esc(a.label) + '">×</button></span>';
            }).join('') +
            '<span class="pc-add"><input type="text" id="pc-q" autocomplete="off" placeholder="Ajouter : pénicillines, aspirine…" aria-label="Ajouter une allergie"><span class="pc-drop" hidden></span></span>' +
          '</div></div>' +
          (client && client.allergies ? '<div class="pc-legacy">Noté en texte dans le dossier : « ' + esc(client.allergies) + ' ». Ajoutez-le ci-dessus pour qu’il soit vérifié.</div>' : '') +
          (current.length ? '<div class="pc-row"><span class="pc-lbl">En cours</span><div class="pc-current">' + current.map(function (t) {
            return '<span class="pc-cur">' + esc(t.label) + ' <small>· ' + new Date(t.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + '</small></span>';
          }).join('') + '</div></div>' : '') +
          (showPreg ? '<div class="pc-row"><span class="pc-lbl">Grossesse</span>' + seg('pregnancy', ctx.pregnancy, [['none', 'Non'], ['pregnant', 'Enceinte'], ['breastfeeding', 'Allaite']]) + '</div>' : '') +
          '<div class="pc-row"><span class="pc-lbl">Fonction rénale</span>' + seg('renal', ctx.renal, [['normal', 'Normale'], ['moderate', 'IR modérée'], ['severe', 'IR sévère']]) + '</div>' +
          '<div class="pc-row"><span class="pc-lbl">Foie</span>' + seg('hepatic', ctx.hepatic, [['normal', 'Normal'], ['impaired', 'Insuffisance hépatique']]) + '</div>' +
          '<div class="pc-foot"><span class="pc-saved"></span><span>Âge calculé depuis la date de naissance. Traitements en cours : vos ordonnances des 90 derniers jours.</span></div>' +
        '</div>';
    }

    el.addEventListener('click', function (e) {
      if (e.target.closest('.pc-head')) { open = !open; render(); if (open) { var q = el.querySelector('#pc-q'); if (q) q.focus(); } return; }
      var b = e.target.closest('.pc-seg button');
      if (b) { ctx[b.parentNode.dataset.field] = b.dataset.v; render(); save(); changed(); return; }
      var rm = e.target.closest('[data-rm]');
      if (rm) { ctx.allergens.splice(+rm.dataset.rm, 1); render(); save(); changed(); return; }
    });
    el.addEventListener('input', function (e) {
      if (e.target.id !== 'pc-q') return;
      clearTimeout(timer);
      var q = e.target.value.trim(), drop = el.querySelector('.pc-drop');
      if (q.length < 2) { drop.hidden = true; return; }
      timer = setTimeout(async function () {
        var my = ++seq;
        var r = await opts.supa.rpc('allergen_search', { p_q: q, p_limit: 10 });
        if (my !== seq) return;
        var rows = (r.data || []).filter(function (x) { return !ctx.allergens.some(function (a) { return a.key === x.key; }); });
        drop.innerHTML = rows.length ? rows.map(function (x, i) {
          return '<button type="button" data-pick="' + i + '">' + esc(x.label) + (x.kind === 'class' ? ' <small>famille</small>' : '') + '</button>';
        }).join('') : '<span class="pc-none">Aucune molécule ou famille trouvée</span>';
        drop._rows = rows; drop.hidden = false;
      }, 160);
    });
    el.addEventListener('mousedown', function (e) {
      var p = e.target.closest('[data-pick]'); if (!p) return;
      e.preventDefault();
      var x = el.querySelector('.pc-drop')._rows[+p.dataset.pick];
      ctx.allergens.push({ key: x.key, label: x.label, kind: x.kind });
      render(); save(); changed();
      var q = el.querySelector('#pc-q'); if (q) q.focus();
    });

    async function load(clientId) {
      var my = ++seq;
      cid = clientId || null; ctx = null; client = null;
      if (!cid) { el.hidden = true; el.innerHTML = ''; return; }
      if (!me) { var s = await opts.supa.auth.getSession(); me = s.data.session && s.data.session.user.id; }
      var a = await opts.supa.from('clients').select('id,user_id,date_naissance,sexe,allergies').eq('id', cid).maybeSingle();
      var b = await opts.supa.from('patient_clinical_context').select('*').eq('client_id', cid).maybeSingle();
      var h = await opts.supa.rpc('patient_current_treatments', { p_client: cid, p_exclude: opts.getExclude ? opts.getExclude() : null });
      if (my !== seq) return;
      current = (h && h.data) || [];
      client = a.data || null;
      ctx = b.data || { allergens: [], pregnancy: 'none', renal: 'normal', hepatic: 'normal' };
      if (!Array.isArray(ctx.allergens)) ctx.allergens = [];
      open = false;
      render();
      changed();
    }

    return { load: load, clientId: function () { return cid; } };
  }

  window.PatientContext = { mount: mount };
})();
