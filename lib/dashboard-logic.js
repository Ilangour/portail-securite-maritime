// ============================================================
//  dashboard-logic.js — logique de calcul pure des indicateurs
//  affichés (cartes RAG, KPI globaux, tableau réglementaire,
//  graphique) — extrait de portail.js pour être testable
//  indépendamment du navigateur, même principe que
//  lib/planning-logic.js (voir tests/dashboard-logic.spec.js).
//  Chargé en global côté navigateur, via require() côté Node.
// ============================================================

// État réglementaire d'un exercice à une date donnée (dernière réalisation
// vs fréquence). Utilisé à la fois par renderQuickStatus (cartes) et
// renderStatusTable (tableau réglementaire) dans portail.js — mêmes seuils
// (retard < 0 j, alerte <= 14 j), texte/HTML propres à chaque contexte.
function computeRegulatoryStatus(ex, lastDate, today) {
  if (lastDate && !ex.frequence) {
    return { state: 'no-frequency', daysLeft: null, nextDate: null };
  }
  if (!lastDate) {
    return { state: 'never', daysLeft: null, nextDate: null };
  }
  const nextDate = new Date(lastDate);
  nextDate.setDate(nextDate.getDate() + ex.frequence);
  const daysLeft = Math.ceil((nextDate - today) / 864e5);
  const state = daysLeft < 0 ? 'late' : daysLeft <= 14 ? 'warning' : 'ok';
  return { state, daysLeft, nextDate };
}

// KPI globaux (page Indicateurs) : agrège `stats` (déjà calculé via
// analyzeExercise/computePlannedWeeks) sur tous les exercices du navire.
function computeKPIs(exercices, stats, lastDates, today) {
  let totPlan = 0, totReal = 0, totConf = 0, totMank = 0, retards = 0;
  exercices.forEach(ex => {
    const s = stats[ex.id];
    totPlan += s.plannedSoFar; totReal += s.realise;
    totConf += s.conforme;    totMank += s.manquant;

    // En retard si la fréquence réglementaire (dernier + jours) est dépassée
    // OU si une semaine planifiée du planning annuel est manquante à ce jour.
    const last = lastDates[ex.id];
    let enRetard = s.manquant > 0;
    if (!last) enRetard = true;
    else if (ex.frequence) {
      const next = new Date(last); next.setDate(next.getDate() + ex.frequence);
      if (next < today) enRetard = true;
    }
    if (enRetard) retards++;
  });
  const conformite = totReal > 0 ? Math.round(totConf / totReal * 100) : 0;
  const manqPct    = totPlan > 0 ? Math.round(totMank / totPlan * 100) : 0;
  const ratio      = totPlan > 0 ? Math.round(totReal / totPlan * 100) : 0;
  const total      = exercices.length;
  const ajourPct   = total > 0 ? Math.round((total - retards) / total * 100) : 0;
  const retardCls  = ajourPct >= 80 ? 'green' : ajourPct >= 20 ? 'orange' : 'red';
  return { conformite, manqPct, ratio, totReal, ajourPct, retards, total, retardCls };
}

// Segments empilés à 100% du graphique Historique (part réalisée hors
// délai / conforme / manquante). Conforme est un sous-ensemble de Réalisé,
// pas une catégorie à part : "realise" ici = part réalisée hors délai
// uniquement, pour ne pas compter ces exercices deux fois dans le total.
function computeChartSegments(exercices, stats) {
  return exercices.map(ex => {
    const s = stats[ex.id];
    const realiseHorsDelai = s.realise - s.conforme;
    const total = s.realise + s.manquant;
    return {
      id:       ex.id,
      realise:  total > 0 ? Math.round((realiseHorsDelai / total) * 1000) / 10 : 0,
      conforme: total > 0 ? Math.round((s.conforme / total) * 1000) / 10 : 0,
      manquant: total > 0 ? Math.round((s.manquant / total) * 1000) / 10 : 0,
    };
  });
}

const dashboardLogic = { computeRegulatoryStatus, computeKPIs, computeChartSegments };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = dashboardLogic;
} else {
  Object.assign(typeof window !== 'undefined' ? window : globalThis, dashboardLogic);
}
