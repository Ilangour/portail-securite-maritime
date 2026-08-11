// ============================================================
//  planning-logic.js — logique de calcul pure (planning/réalisé)
//
//  Extrait de portail.js pour être testable indépendamment du
//  navigateur (voir tests/planning-logic.spec.js). Chargé en global
//  côté navigateur (<script> classique, avant portail.js) et via
//  require() côté Node pour les tests — même code, aucune duplication.
// ============================================================

function isoWeek(date) {
  const d   = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - jan1) / 864e5) + 1) / 7);
}

function computePlannedWeeks(ex, year) {
  const weeks = new Set();

  // Liste exacte de semaines (ex: DP sur Meridian, sans fréquence fiable) :
  // on suit le document tel quel, pas de formule.
  if (year === 2026 && ex.planning2026 && Array.isArray(ex.planning2026.semaines)) {
    ex.planning2026.semaines.forEach(w => weeks.add(Math.round(w)));
    return weeks;
  }

  let debut, intervalle;
  if (year === 2026 && ex.planning2026) {
    debut = ex.planning2026.debut; intervalle = ex.planning2026.intervalle;
  } else {
    if (!ex.frequence) return weeks; // fréquence inconnue : pas de planning calculable
    debut = 1; intervalle = Math.max(1, Math.round(ex.frequence / 7));
  }
  for (let w = debut; w <= 53; w += intervalle) weeks.add(Math.round(w));
  return weeks;
}

// Associe chaque réalisation à sa semaine planifiée la plus proche (avant OU
// après — une réalisation un peu en avance ou en retard honore quand même
// l'échéance). On traite les paires les plus proches en premier pour un
// appariement au plus juste. Ce qui reste non apparié et déjà échu compte en
// "manquant" — c'est un état réversible, recalculé à chaque rafraîchissement :
// dès qu'une réalisation vient couvrir cette semaine, elle en sort automatiquement.
function analyzeExercise(plannedWeeksSet, doneWeeksSet, todayWeek) {
  const planned = [...plannedWeeksSet].sort((a, b) => a - b);
  const done     = [...doneWeeksSet].sort((a, b) => a - b);

  const freePlanned = new Set(planned);
  const freeDone     = new Set(done);

  const pairs = [];
  planned.forEach(p => done.forEach(d => pairs.push({ p, d, dist: Math.abs(d - p) })));
  pairs.sort((a, b) => a.dist - b.dist);

  pairs.forEach(({ p, d }) => {
    if (!freePlanned.has(p) || !freeDone.has(d)) return; // déjà appariés
    freePlanned.delete(p);
    freeDone.delete(d);
  });

  // Manquant = toute semaine planifiée déjà échue et jamais couverte, à ce jour.
  const missing = [...freePlanned].filter(w => w <= todayWeek).length;
  return { missing };
}

const planningLogic = { isoWeek, computePlannedWeeks, analyzeExercise };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = planningLogic;
} else {
  Object.assign(typeof window !== 'undefined' ? window : globalThis, planningLogic);
}
