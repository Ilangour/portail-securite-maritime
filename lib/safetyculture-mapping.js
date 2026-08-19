// ============================================================
//  safetyculture-mapping.js — correspondance entre les données brutes
//  d'une inspection SafetyCulture (template "Exercices de sécurité")
//  et les identifiants internes du portail (navire / type d'exercice).
//
//  Construit à partir d'un échantillon réel d'inspections (pas deviné) :
//  voir README.md, section "Intégration SafetyCulture", pour le détail
//  de la vérification faite avant d'écrire ce mapping.
// ============================================================

// Nom de site SafetyCulture (audit_data.site.name) -> id navire (CONFIG.NAVIRES).
// Attention à la casse et aux noms sans préfixe commun (Sirius, Orion) — pas de
// transformation automatique fiable, mapping explicite obligatoire.
const SITE_TO_NAVIRE = {
  'MV AURORE':   'Aurore',
  'MV MERIDIAN': 'Meridian',
  'SIRIUS':      'Sirius',
  'ORION':       'Orion',
  'MV ATLAS':    'Atlas',
  'MV NEPTUNE':  'Neptune',
  'MV VEGA':     'Vega',
  'MV POLARIS':  'Polaris',
};

// Libellé de l'option cochée dans "Choix du type d'exercice" -> id exercice
// (CONFIG.CATALOGUE). "AUTRE" n'a pas de correspondance : volontairement
// absent d'ici, voir mapExerciceLabel ci-dessous pour son traitement.
const LABEL_TO_EXERCICE = {
  'ABANDON':                              'ABANDON',
  'INCENDIE':                             'INCENDIE',
  'AVARIE/BARRE EN SECOURS':              'AVARIE',
  "ASSECHEMENT/ENVAHISSEMENT/VOIE D'EAU": 'ENVAHISSEMENT',
  'ASSISTANCE MEDICALE':                  'MEDICAL',
  'HOMME A LA MER (MOB)':                 'MOB',
  "MOUILLAGE D'URGENCE":                  'MOUILLAGE',
  'POLLUTION':                            'POLLUTION',
  'ESPACE CLOS':                          'ESPACE_CLOS',
  "LARGAGE/REMORQUAGE D'URGENCE":         'LARGAGE',
  // SURETE et DP : jamais observés dans les inspections réelles à ce jour
  // (pas de couverture confirmée par ce template) — pas de mapping ajouté
  // à l'aveugle, à compléter si un libellé correspondant apparaît un jour.
};

function mapSiteToNavire(siteName) {
  return SITE_TO_NAVIRE[siteName] || null;
}

// Retourne l'id interne si connu, sinon le libellé brut (pas de perte
// silencieuse de données — une inspection avec un type non reconnu doit
// tout de même apparaître dans l'Historique, décision utilisateur).
function mapExerciceLabel(label) {
  return LABEL_TO_EXERCICE[label] || label;
}

// Extrait les champs utiles d'une inspection SafetyCulture complète (réponse
// de GET /audits/{id}). Partagé entre api/safetyculture-webhook.js (webhook
// temps réel) et api/reconcile-safetyculture.js (rattrapage quotidien) —
// ces deux fichiers doivent lire une inspection exactement de la même façon,
// sinon ils divergent silencieusement sur ce qu'ils enregistrent (vécu le
// 10/08/2026 : la copie du rattrapage avait oublié officier/scénario).
function extractExerciseData(inspection) {
  let dateExercice = null, typeLabels = [], officier = '', scenario = '';
  const walk = (items) => (items || []).forEach(it => {
    if (it.label === "Date de l'exercice et heure de début") {
      dateExercice = it.responses?.datetime || dateExercice;
    }
    if (it.label?.startsWith("Choix du type d'exercice")) {
      typeLabels = (it.responses?.selected || []).map(s => s.label);
    }
    if (it.label === "Officier dirigeant l'exercice") {
      officier = it.responses?.text || '';
    }
    if (it.label === 'Scénario') {
      scenario = it.responses?.text || '';
    }
    if (it.items) walk(it.items);
  });
  walk(inspection.header_items);
  walk(inspection.items);
  return {
    siteName: inspection.audit_data?.site?.name || null,
    dateExercice,
    typeLabels,
    officier,
    scenario,
    completed: !!inspection.audit_data?.date_completed,
  };
}

// Résout quoi faire d'une inspection SafetyCulture face à d'éventuelles
// saisies manuelles déjà existantes pour le même navire+type+date (ex: un
// exercice saisi à la main dans le portail parce que l'équipage n'a pas vu
// l'enregistrement automatique arriver, puis l'inspection SafetyCulture
// correspondante finit par être reçue). `candidates` : lignes déjà en base
// pour ce navire+type+date, non liées à une inspection
// (safetyculture_audit_id IS NULL) et non supprimées.
// - 0 candidat  : rien à rapprocher, insertion normale.
// - 1 candidat  : rapprochement sûr, on complète cette ligne au lieu d'en
//   créer une nouvelle (évite un doublon).
// - 2+ candidats : rapprochement ambigu — on insère quand même pour ne pas
//   perdre l'inspection, mais signalé comme ambigu pour revue manuelle
//   plutôt que de deviner laquelle compléter.
function resolveReconciliation(candidates) {
  if (candidates.length === 1) return { action: 'update', id: candidates[0].id };
  return { action: 'insert', ambiguous: candidates.length > 1 };
}

const safetycultureMapping = { SITE_TO_NAVIRE, LABEL_TO_EXERCICE, mapSiteToNavire, mapExerciceLabel, extractExerciseData, resolveReconciliation };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = safetycultureMapping;
} else {
  Object.assign(typeof window !== 'undefined' ? window : globalThis, safetycultureMapping);
}
