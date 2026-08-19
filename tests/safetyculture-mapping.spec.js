// ============================================================
//  Tests unitaires — correspondance SafetyCulture (lib/safetyculture-mapping.js)
//
//  Purs (pas de navigateur, pas de réseau). Les cas repris correspondent
//  aux valeurs réellement observées sur des inspections SafetyCulture
//  (voir README.md, section "Intégration SafetyCulture").
// ============================================================
const { test, expect } = require('@playwright/test');
const { mapSiteToNavire, mapExerciceLabel, resolveReconciliation } = require('../lib/safetyculture-mapping.js');

test.describe('mapSiteToNavire', () => {
  const cas = [
    ['MV AURORE', 'Aurore'],
    ['MV MERIDIAN', 'Meridian'],
    ['SIRIUS', 'Sirius'],
    ['ORION', 'Orion'],
    ['MV ATLAS', 'Atlas'],
    ['MV NEPTUNE', 'Neptune'],
    ['MV VEGA', 'Vega'],
    ['MV POLARIS', 'Polaris'],
  ];
  for (const [site, navire] of cas) {
    test(`${site} -> ${navire}`, () => {
      expect(mapSiteToNavire(site)).toBe(navire);
    });
  }

  test('site inconnu -> null (pas de perte silencieuse vers un mauvais navire)', () => {
    expect(mapSiteToNavire('MV INCONNU')).toBeNull();
    expect(mapSiteToNavire('')).toBeNull();
    expect(mapSiteToNavire(undefined)).toBeNull();
  });
});

test.describe('mapExerciceLabel', () => {
  const cas = [
    ['ABANDON', 'ABANDON'],
    ['INCENDIE', 'INCENDIE'],
    ['AVARIE/BARRE EN SECOURS', 'AVARIE'],
    ["ASSECHEMENT/ENVAHISSEMENT/VOIE D'EAU", 'ENVAHISSEMENT'],
    ['ASSISTANCE MEDICALE', 'MEDICAL'],
    ['HOMME A LA MER (MOB)', 'MOB'],
    ["MOUILLAGE D'URGENCE", 'MOUILLAGE'],
    ['POLLUTION', 'POLLUTION'],
    ['ESPACE CLOS', 'ESPACE_CLOS'],
    ["LARGAGE/REMORQUAGE D'URGENCE", 'LARGAGE'],
  ];
  for (const [label, id] of cas) {
    test(`"${label}" -> ${id}`, () => {
      expect(mapExerciceLabel(label)).toBe(id);
    });
  }

  test('libellé non reconnu -> renvoyé tel quel (visible dans l\'Historique, pas perdu)', () => {
    expect(mapExerciceLabel('AUTRE')).toBe('AUTRE');
    expect(mapExerciceLabel('UN LIBELLE JAMAIS VU')).toBe('UN LIBELLE JAMAIS VU');
  });

  test('"AUTRE" -> DP sur les navires sans option DP dédiée dans le template', () => {
    expect(mapExerciceLabel('AUTRE', 'Aurore')).toBe('DP');
    expect(mapExerciceLabel('AUTRE', 'Meridian')).toBe('DP');
    expect(mapExerciceLabel('AUTRE', 'Neptune')).toBe('DP');
  });

  test('"AUTRE" reste "AUTRE" sur un navire sans DP', () => {
    expect(mapExerciceLabel('AUTRE', 'Sirius')).toBe('AUTRE');
    expect(mapExerciceLabel('AUTRE', 'Orion')).toBe('AUTRE');
    expect(mapExerciceLabel('AUTRE', undefined)).toBe('AUTRE');
  });
});

test.describe('resolveReconciliation', () => {
  test('aucun candidat -> insertion normale', () => {
    expect(resolveReconciliation([])).toEqual({ action: 'insert', ambiguous: false });
  });

  test('un candidat -> complète la saisie manuelle existante', () => {
    expect(resolveReconciliation([{ id: 305 }])).toEqual({ action: 'update', id: 305 });
  });

  test('plusieurs candidats -> insertion quand même, mais signalée ambiguë', () => {
    expect(resolveReconciliation([{ id: 1 }, { id: 2 }])).toEqual({ action: 'insert', ambiguous: true });
  });
});
