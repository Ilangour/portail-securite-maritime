// ============================================================
//  Tests unitaires — fusion catalogue/navire (config.js)
//
//  Ne nécessitent ni navigateur ni réseau. Vérifie que
//  CONFIG.getExercices(navire) fusionne correctement le catalogue
//  partagé avec les données propres à chaque navire, et exclut les
//  exercices non concernés par un navire donné (ex: DP sur Sirius).
// ============================================================
const { test, expect } = require('@playwright/test');
const CONFIG = require('../config.js');

test.describe('CONFIG.getExercices', () => {
  test('Aurore, Meridian et Neptune ont bien les 11 exercices du catalogue', () => {
    expect(CONFIG.getExercices('Aurore')).toHaveLength(11);
    expect(CONFIG.getExercices('Meridian')).toHaveLength(11);
    expect(CONFIG.getExercices('Neptune')).toHaveLength(11);
  });

  test('Neptune : DP est bien présent, fréquence 90j (13 semaines), début semaine 2', () => {
    const dp = CONFIG.getExercices('Neptune').find(e => e.id === 'DP');
    expect(dp).toBeDefined();
    expect(dp.frequence).toBe(90);
    expect(dp.planning2026).toEqual({ debut: 2, intervalle: 13 });
  });

  test('Sirius n\'a que 10 exercices : DP est exclu (non concerné)', () => {
    const exs = CONFIG.getExercices('Sirius');
    expect(exs).toHaveLength(10);
    expect(exs.find(e => e.id === 'DP')).toBeUndefined();
  });

  test('Sirius : MOUILLAGE, ESPACE_CLOS et MEDICAL sont à 56 jours (8 semaines)', () => {
    const exs = CONFIG.getExercices('Sirius');
    for (const id of ['MOUILLAGE', 'ESPACE_CLOS', 'MEDICAL']) {
      const ex = exs.find(e => e.id === id);
      expect(ex.frequence).toBe(56);
      expect(ex.planning2026.intervalle).toBe(8);
    }
  });

  test('un navire inconnu ne fait planter getExercices (retourne un catalogue vide de données navire)', () => {
    const exs = CONFIG.getExercices('NavireInexistant');
    expect(exs).toEqual([]);
  });

  test('Atlas : SURETE remplace DP, DP est absent, SURETE est présent (84j/12 semaines)', () => {
    const exs = CONFIG.getExercices('Atlas');
    expect(exs.find(e => e.id === 'DP')).toBeUndefined();
    const surete = exs.find(e => e.id === 'SURETE');
    expect(surete).toBeDefined();
    expect(surete.frequence).toBe(84);
    expect(surete.planning2026.intervalle).toBe(12);
  });

  test('SURETE n\'apparaît que sur Atlas, pas sur les autres navires', () => {
    for (const navire of ['Aurore', 'Meridian', 'Sirius', 'Neptune']) {
      expect(CONFIG.getExercices(navire).find(e => e.id === 'SURETE')).toBeUndefined();
    }
  });
});
