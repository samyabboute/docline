/* Docline · faits vérifiés d'un médecin (annuaire, page publique)
 * Données : doctor_public_facts(id) / doctor_public_facts_many(ids)
 *   live       état de la file en direct (cabinets qui utilisent la file)
 *   badges     badges obtenus, avec leur base de calcul (n)
 *   best_times meilleurs moments pour venir (attente médiane mesurée)
 * Tout est mesuré par Docline : rien n'est déclaré par le médecin.
 */
(function () {
  var DAYS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  var ICONS = {
    ponctuel: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',
    prend_le_temps: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    attente_courte: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    a_l_ecoute: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z"/>',
    explique: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M8 7h8M8 11h6"/>',
    recommande: '<path d="M7 10v11H4V10zM7 10l4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 17.7 21H7"/>'
  };
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

  function badgeValue(b) {
    if (b.key === 'prend_le_temps') return b.value + ' min en moyenne';
    if (b.key === 'attente_courte') return '~' + b.value + ' min d’attente';
    if (b.key === 'ponctuel') return Math.round(b.value / 10) + ' fois sur 10 à l’heure';
    return b.value + ' % des patients';
  }
  function basis(b) {
    return ['prend_le_temps', 'attente_courte', 'ponctuel'].indexOf(b.key) !== -1 ? b.n + ' passages mesurés' : b.n + ' patients reçus';
  }

  // Ligne « en direct » ; null si le cabinet n'utilise pas la file
  function live(l) {
    if (!l) return null;
    var map = {
      paused: ['pause', 'File en pause'],
      closed: ['closed', 'Fermé en ce moment'],
      after_hours: ['closed', 'Fermé pour aujourd’hui'],
      not_open_yet: ['soon', 'Ouvre ' + (l.open_from ? 'à ' + l.open_from : 'bientôt')],
      last_entry_passed: ['closed', 'Plus d’inscription aujourd’hui'],
      full: ['closed', 'Complet aujourd’hui']
    };
    if (!l.accepting) { var m = map[l.reason] || ['closed', 'Fermé en ce moment']; return { tone: m[0], text: m[1] }; }
    if (!l.waiting) return { tone: 'open', text: 'Ouvert · pas d’attente en ce moment' };
    return { tone: 'open', text: 'Ouvert · ' + l.waiting + ' patient' + (l.waiting > 1 ? 's' : '') + ' en attente' + (l.estimate ? ' · ~' + l.estimate + ' min' : '') };
  }

  function liveChip(l) {
    var x = live(l); if (!x) return '';
    return '<span class="df-live df-' + x.tone + '"><i></i>' + esc(x.text) + '</span>';
  }
  function badgeChip(b) {
    return '<span class="df-badge" title="' + esc(b.detail + ' · ' + basis(b)) + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[b.key] || '') + '</svg>' + esc(b.label) + '</span>';
  }
  function badgeCard(b) {
    return '<div class="df-card"><div class="df-card-ic"><svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[b.key] || '') + '</svg></div>' +
      '<div><div class="df-card-t">' + esc(b.label) + '</div><div class="df-card-v">' + esc(badgeValue(b)) + '</div>' +
      '<div class="df-card-n">' + esc(b.detail) + ' · ' + esc(basis(b)) + '</div></div></div>';
  }
  function bestTimes(list) {
    if (!list || !list.length) return '';
    return list.map(function (t) {
      return '<div class="df-time"><b>' + DAYS[t.dow].charAt(0).toUpperCase() + DAYS[t.dow].slice(1) + ', arrivée vers ' + t.hour + ' h</b><span>~' + t.median + ' min d’attente · ' + t.n + ' passages</span></div>';
    }).join('');
  }

  window.DoctorFacts = { live: live, liveChip: liveChip, badgeChip: badgeChip, badgeCard: badgeCard, bestTimes: bestTimes, badgeValue: badgeValue, basis: basis, DAYS: DAYS, ICONS: ICONS };
})();
