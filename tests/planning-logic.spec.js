// ============================================================
//  Tests unitaires — logique de calcul pure (lib/planning-logic.js)
//
//  Ne nécessitent ni navigateur ni réseau : purs calculs sur des
//  dates/semaines. Les cas "analyzeExercise" reprennent des situations
//  réelles déjà vérifiées à la main pendant le développement (voir
//  historique du projet) pour éviter les régressions silencieuses.
// ============================================================
const { test, expect } = require('@playwright/test');
const { isoWeek, computePlannedWeeks, analyzeExercise } = require('../lib/planning-logic.js');

test.describe('isoWeek', () => {
  // Paires date -> semaine ISO vérifiées sur de vrais enregistrements Airtable
  const cas = [
    ['2026-01-01', 1],   // ENVAHISSEMENT (import historique)
    ['2026-01-08', 2],   // MÉDICAL (import historique)
    ['2026-06-18', 25],  // LARGAGE-REMORQUAGE URGENCE (import historique)
    ['2026-07-09', 28],  // ABANDON (Safety Culture)
    ['2026-07-15', 29],  // INCENDIE (Safety Culture)
  ];

  for (const [dateStr, semaineAttendue] of cas) {
    test(`${dateStr} => semaine ${semaineAttendue}`, () => {
      const date = new Date(dateStr + 'T12:00:00');
      expect(isoWeek(date)).toBe(semaineAttendue);
    });
  }
});

test.describe('computePlannedWeeks', () => {
  test('ABANDON 2026 (debut 1, intervalle 4)', () => {
    const ex = { frequence: 30, planning2026: { debut: 1, intervalle: 4 } };
    const weeks = [...computePlannedWeeks(ex, 2026)].sort((a, b) => a - b);
    expect(weeks).toEqual([1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53]);
  });

  test('POLLUTION 2026 (debut 4, intervalle 12)', () => {
    const ex = { frequence: 84, planning2026: { debut: 4, intervalle: 12 } };
    const weeks = [...computePlannedWeeks(ex, 2026)].sort((a, b) => a - b);
    expect(weeks).toEqual([4, 16, 28, 40, 52]);
  });

  test('DP 2026 (debut 5, intervalle 17)', () => {
    const ex = { frequence: 90, planning2026: { debut: 5, intervalle: 17 } };
    const weeks = [...computePlannedWeeks(ex, 2026)].sort((a, b) => a - b);
    expect(weeks).toEqual([5, 22, 39]);
  });

  test('année sans planning2026 défini => intervalle dérivé de la fréquence', () => {
    const ex = { frequence: 84 }; // pas de planning2026
    const weeks = [...computePlannedWeeks(ex, 2027)].sort((a, b) => a - b);
    // intervalle = round(84/7) = 12, debut = 1
    expect(weeks).toEqual([1, 13, 25, 37, 49]);
  });

  test('DP Meridian 2026 (liste exacte de semaines, pas de fréquence)', () => {
    const ex = { frequence: null, planning2026: { semaines: [2, 12, 19, 29, 35, 47] } };
    const weeks = [...computePlannedWeeks(ex, 2026)].sort((a, b) => a - b);
    expect(weeks).toEqual([2, 12, 19, 29, 35, 47]);
  });

  test('fréquence inconnue et année hors 2026 => aucun planning calculable', () => {
    const ex = { frequence: null };
    const weeks = [...computePlannedWeeks(ex, 2027)];
    expect(weeks).toEqual([]);
  });
});

test.describe('analyzeExercise — cas réels vérifiés manuellement', () => {
  test('ESPACE CLOS : fait un peu en avance (S15) et deux fois en retard (S10, S25) => 0 manquant', () => {
    const planned = new Set([8, 16, 24, 32, 40, 48]);
    const done     = new Set([10, 15, 25]);
    expect(analyzeExercise(planned, done, 29).missing).toBe(0);
  });

  test('MOUILLAGE : S11 pile à l\'heure, S19 couverte en avance par S18, S27 jamais rattrapée => 1 manquant', () => {
    const planned = new Set([11, 19, 27, 35, 43, 51]);
    const done     = new Set([11, 18]);
    expect(analyzeExercise(planned, done, 29).missing).toBe(0 + 1);
  });

  test('ABANDON : doublon S21 dédupliqué par le Set, tout est couvert => 0 manquant', () => {
    const planned = new Set([1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53]);
    const done     = new Set([3, 4, 5, 8, 10, 12, 16, 20, 21, 24, 26, 28]);
    expect(analyzeExercise(planned, done, 29).missing).toBe(0);
  });

  test('réversibilité : une semaine manquante disparaît dès qu\'une réalisation la couvre', () => {
    const planned = new Set([11, 19, 27, 35, 43, 51]);
    const avant = analyzeExercise(planned, new Set([11, 18]), 29);
    expect(avant.missing).toBe(1); // S27 manquante

    const apres = analyzeExercise(planned, new Set([11, 18, 27]), 29);
    expect(apres.missing).toBe(0); // S27 désormais couverte
  });

  test('rien réalisé, deux échéances déjà passées => 2 manquants', () => {
    const planned = new Set([1, 10]);
    expect(analyzeExercise(planned, new Set(), 15).missing).toBe(2);
  });

  test('rien réalisé mais échéances pas encore arrivées => 0 manquant', () => {
    const planned = new Set([30, 40]);
    expect(analyzeExercise(planned, new Set(), 10).missing).toBe(0);
  });
});
