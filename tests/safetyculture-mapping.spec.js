// ============================================================
//  Tests unitaires — correspondance SafetyCulture (lib/safetyculture-mapping.js)
//
//  Purs (pas de navigateur, pas de réseau). Les cas repris correspondent
//  aux valeurs réellement observées sur des inspections SafetyCulture
//  (voir README.md, section "Intégration SafetyCulture").
// ============================================================
const { test, expect } = require('@playwright/test');
const { mapSiteToNavire, mapExerciceLabel } = require('../lib/safetyculture-mapping.js');

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
});
