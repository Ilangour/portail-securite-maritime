// ============================================================
//  Tests unitaires — logique de calcul pure des indicateurs affichés
//  (lib/dashboard-logic.js). Ne nécessitent ni navigateur ni réseau.
//
//  Ces fonctions étaient auparavant inline dans portail.js
//  (renderQuickStatus/renderStatusTable/renderKPIs/renderChart) et
//  n'étaient vérifiées qu'indirectement par tests/smoke.spec.js
//  (absence d'erreur console, pas le contenu réellement affiché) —
//  voir docs/PLAN-LIVRAISON.md.
// ============================================================
const { test, expect } = require('@playwright/test');
const { computeRegulatoryStatus, computeKPIs, computeChartSegments } = require('../lib/dashboard-logic.js');

test.describe('computeRegulatoryStatus', () => {
  const today = new Date('2026-06-15T12:00:00');

  test('jamais réalisé => "never"', () => {
    const ex = { frequence: 30 };
    expect(computeRegulatoryStatus(ex, null, today)).toEqual({ state: 'never', daysLeft: null, nextDate: null });
  });

  test('déjà réalisé mais fréquence inconnue => "no-frequency" (pas d\'échéance calculée à tort)', () => {
    const ex = { frequence: null };
    const last = new Date('2026-05-01T12:00:00');
    expect(computeRegulatoryStatus(ex, last, today)).toEqual({ state: 'no-frequency', daysLeft: null, nextDate: null });
  });

  test('échéance dépassée (daysLeft négatif) => "late"', () => {
    const ex = { frequence: 30 };
    const last = new Date('2026-05-01T12:00:00'); // échéance 2026-05-31, déjà passée
    const { state, daysLeft } = computeRegulatoryStatus(ex, last, today);
    expect(state).toBe('late');
    expect(daysLeft).toBeLessThan(0);
  });

  test('échéance dans exactement 14 jours => "warning" (borne incluse)', () => {
    const ex = { frequence: 30 };
    const last = new Date('2026-05-30T12:00:00'); // échéance 2026-06-29 = aujourd'hui + 14j
    const { state, daysLeft } = computeRegulatoryStatus(ex, last, today);
    expect(daysLeft).toBe(14);
    expect(state).toBe('warning');
  });

  test('échéance dans exactement 15 jours => "ok" (juste au-dessus de la borne)', () => {
    const ex = { frequence: 30 };
    const last = new Date('2026-05-31T12:00:00'); // échéance 2026-06-30 = aujourd'hui + 15j
    const { state, daysLeft } = computeRegulatoryStatus(ex, last, today);
    expect(daysLeft).toBe(15);
    expect(state).toBe('ok');
  });

  test('échéance dans exactement 0 jour (aujourd\'hui) => "warning", pas "late"', () => {
    const ex = { frequence: 30 };
    const last = new Date('2026-05-16T12:00:00'); // échéance 2026-06-15 = aujourd'hui pile
    const { state, daysLeft } = computeRegulatoryStatus(ex, last, today);
    expect(daysLeft).toBe(0);
    expect(state).toBe('warning');
  });
});

test.describe('computeKPIs', () => {
  const today = new Date('2026-06-15T12:00:00');

  test('cas mixte : conforme, en retard (manquant), jamais réalisé', () => {
    const exercices = [
      { id: 'A', frequence: 30 }, // à jour
      { id: 'B', frequence: 60 }, // manquant + échéance dépassée
      { id: 'C', frequence: null }, // jamais réalisé
    ];
    const stats = {
      A: { plannedSoFar: 4, realise: 4, conforme: 4, manquant: 0 },
      B: { plannedSoFar: 2, realise: 1, conforme: 1, manquant: 1 },
      C: { plannedSoFar: 0, realise: 0, conforme: 0, manquant: 0 },
    };
    const lastDates = {
      A: new Date('2026-06-01T12:00:00'),
      B: new Date('2026-01-01T12:00:00'),
      C: null,
    };

    const kpis = computeKPIs(exercices, stats, lastDates, today);
    expect(kpis).toEqual({
      conformite: 100, // 5/5 conformes sur ce qui est réalisé
      manqPct: 17,      // round(1/6 * 100)
      ratio: 83,        // round(5/6 * 100)
      totReal: 5,
      ajourPct: 33,     // round((3-2)/3 * 100) : A à jour, B et C en retard
      retards: 2,
      total: 3,
      retardCls: 'orange', // 20 <= 33 < 80
    });
  });

  test('aucun exercice pour ce navire => tout à zéro, pas de division par zéro', () => {
    const kpis = computeKPIs([], {}, {}, today);
    expect(kpis).toEqual({
      conformite: 0, manqPct: 0, ratio: 0, totReal: 0,
      ajourPct: 0, retards: 0, total: 0, retardCls: 'red',
    });
  });

  test('tout à jour => retardCls "green"', () => {
    const exercices = [{ id: 'A', frequence: 30 }];
    const stats = { A: { plannedSoFar: 1, realise: 1, conforme: 1, manquant: 0 } };
    const lastDates = { A: new Date('2026-06-10T12:00:00') };
    expect(computeKPIs(exercices, stats, lastDates, today).retardCls).toBe('green');
  });
});

test.describe('computeChartSegments', () => {
  test('répartit réalisé hors délai / conforme / manquant en pourcentages du total', () => {
    const exercices = [{ id: 'A' }];
    const stats = { A: { realise: 5, conforme: 3, manquant: 2 } }; // total = 7, hors délai = 5-3 = 2
    const [seg] = computeChartSegments(exercices, stats);
    expect(seg).toEqual({ id: 'A', realise: 28.6, conforme: 42.9, manquant: 28.6 });
  });

  test('conforme = réalisé (aucun hors délai) => segment "realise" à 0', () => {
    const exercices = [{ id: 'A' }];
    const stats = { A: { realise: 4, conforme: 4, manquant: 0 } };
    const [seg] = computeChartSegments(exercices, stats);
    expect(seg).toEqual({ id: 'A', realise: 0, conforme: 100, manquant: 0 });
  });

  test('rien de planifié ni réalisé => tous les segments à 0, pas de division par zéro', () => {
    const exercices = [{ id: 'A' }];
    const stats = { A: { realise: 0, conforme: 0, manquant: 0 } };
    const [seg] = computeChartSegments(exercices, stats);
    expect(seg).toEqual({ id: 'A', realise: 0, conforme: 0, manquant: 0 });
  });
});
