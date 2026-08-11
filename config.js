// ============================================================
//  CONFIG — Suivi des exercices de sécurité maritime
//
//  Le token Airtable et l'ID de base ne sont PLUS ici : ils sont
//  gérés côté serveur (variables d'environnement Vercel), via le
//  proxy /api/airtable/... — voir api/airtable/[...path].js.
//  Ce fichier ne contient plus aucun secret et peut être commité.
// ============================================================
//
//  TABLE AIRTABLE : "Exercices_Realises"
//  Champs obligatoires :
//    - Navire          (Texte)
//    - Type_Exercice   (Texte)      ex: "ABANDON"
//    - Nom_Exercice    (Texte)      ex: "ABANDON"
//    - Date_Realisation(Date)
//    - Semaine         (Nombre)     numéro de semaine ISO
//    - Annee           (Nombre)     ex: 2026
//    - Source          (Texte)      "Formulaire TB", "Safety Culture", "Manuel"
//    - Saisi_Par       (Texte)
//    - Observations    (Long text)
// ============================================================

const CONFIG = {
  // Client ID OAuth Google (public, pas un secret — voir README.md pour
  // le détail de l'authentification). La vraie protection se fait côté
  // serveur (api/db.js -> api/_auth.js), pas ici.
  GOOGLE_CLIENT_ID: 'VOTRE_CLIENT_ID.apps.googleusercontent.com',

  NAVIRES: ['Aurore', 'Meridian', 'Sirius', 'Neptune', 'Atlas', 'Orion', 'Vega', 'Polaris'],

  ANNEES: [2024, 2025, 2026, 2027],

  // ----------------------------------------------------------------
  //  Catalogue des 11 exercices de sécurité — identique sur toute la
  //  flotte (même id/nom/référence réglementaire/icône). Seules la
  //  fréquence et le planning annuel changent d'un navire à l'autre
  //  (voir NAVIRES_DATA ci-dessous).
  // ----------------------------------------------------------------
  CATALOGUE: [
    { id: 'ABANDON',      nom: 'ABANDON',                      ref: 'div 222 §4.9.3.2 / MSC.402(96)', icon: '🚤' },
    { id: 'INCENDIE',     nom: 'INCENDIE',                     ref: 'div 222 §4.3.4.9.3',              icon: '🔥' },
    { id: 'AVARIE',       nom: 'AVARIE',                       ref: 'div 222 §4.6.3.4',                icon: '⚙️' },
    { id: 'ENVAHISSEMENT',nom: 'ENVAHISSEMENT',                ref: 'div 222 §4.7.2.4',                icon: '💧' },
    { id: 'MEDICAL',      nom: 'MÉDICAL',                      ref: 'div 222 §4.4.2',                  icon: '🩺' },
    { id: 'MOB',          nom: 'MOB',                          ref: 'div 222 §4.10.3.7',               icon: '🆘' },
    { id: 'MOUILLAGE',    nom: 'MOUILLAGE',                    ref: 'div 222 §6.2.3.6',                icon: '⚓' },
    { id: 'POLLUTION',    nom: 'POLLUTION',                    ref: 'div 222 §10.3.3.3',               icon: '🌊' },
    { id: 'ESPACE_CLOS',  nom: 'ESPACE CLOS',                  ref: 'résolution OMI A1050(27)',        icon: '🚪' },
    { id: 'LARGAGE',      nom: 'LARGAGE-REMORQUAGE URGENCE',   ref: 'Div 222 §4.11.2.1',               icon: '🔗' },
    { id: 'DP',           nom: 'DP',                           ref: '—',                               icon: '🧭' },
    { id: 'SURETE',       nom: 'SÛRETÉ',                       ref: '—',                               icon: '🛡️' },
  ],

  // ----------------------------------------------------------------
  //  Données propres à chaque navire : fréquence réglementaire (jours)
  //  + planning 2026 par exercice.
  //  planning2026 : { debut, intervalle } (formule, semaines) — le cas
  //  général — OU { semaines: [...] } pour une liste exacte de semaines
  //  quand la fréquence n'est pas fiable/disponible (ex: DP sur Meridian).
  // ----------------------------------------------------------------
  NAVIRES_DATA: {
    Aurore: {
      // ABANDON/INCENDIE décalés d'une semaine en arrière (debut 1 -> 4) le
      // 10/08/2026 pour se caler sur les relèves d'équipage réelles plutôt
      // que sur la grille brute du document source — semaine 1 (qui aurait
      // donné une semaine "0" invalide) disparaît, 13 occurrences/an au lieu
      // de 14, décision utilisateur assumée.
      ABANDON:       { frequence: 30, planning2026: { debut: 4,  intervalle: 4 } },
      INCENDIE:      { frequence: 30, planning2026: { debut: 4,  intervalle: 4 } },
      AVARIE:        { frequence: 84, planning2026: { debut: 6,  intervalle: 12 } },
      ENVAHISSEMENT: { frequence: 84, planning2026: { debut: 3,  intervalle: 12 } },
      MEDICAL:       { frequence: 84, planning2026: { debut: 1,  intervalle: 12 } },
      MOB:           { frequence: 84, planning2026: { debut: 7,  intervalle: 12 } },
      MOUILLAGE:     { frequence: 84, planning2026: { debut: 11, intervalle: 8 } },
      POLLUTION:     { frequence: 84, planning2026: { debut: 4,  intervalle: 12 } },
      ESPACE_CLOS:   { frequence: 56, planning2026: { debut: 8,  intervalle: 8 } },
      LARGAGE:       { frequence: 84, planning2026: { debut: 12, intervalle: 12 } },
      DP:            { frequence: 90, planning2026: { debut: 5,  intervalle: 17 } },
    },

    // Source : document de planning annuel fourni par l'armateur — début = première semaine
    // réellement planifiée dans le document, intervalle = fréquence
    // réglementaire (jours) convertie en semaines. DP : pas de fréquence
    // fiable dans le document, on suit la liste exacte de semaines
    // planifiées telle quelle (pas de champ fréquence pour l'instant).
    Meridian: {
      ABANDON:       { frequence: 30, planning2026: { debut: 2,  intervalle: 4 } },
      INCENDIE:      { frequence: 30, planning2026: { debut: 2,  intervalle: 4 } },
      AVARIE:        { frequence: 84, planning2026: { debut: 7,  intervalle: 12 } },
      ENVAHISSEMENT: { frequence: 84, planning2026: { debut: 8,  intervalle: 12 } },
      MEDICAL:       { frequence: 63, planning2026: { debut: 5,  intervalle: 9 } },
      MOB:           { frequence: 84, planning2026: { debut: 4,  intervalle: 12 } },
      MOUILLAGE:     { frequence: 84, planning2026: { debut: 3,  intervalle: 12 } },
      POLLUTION:     { frequence: 84, planning2026: { debut: 9,  intervalle: 12 } },
      ESPACE_CLOS:   { frequence: 56, planning2026: { debut: 11, intervalle: 8 } },
      LARGAGE:       { frequence: 84, planning2026: { debut: 12, intervalle: 12 } },
      DP:            { frequence: null, planning2026: { semaines: [2, 12, 19, 29, 35, 47] } },
    },

    // Planning repris de Meridian (pas de document source propre à Sirius pour
    // l'instant), en adaptant uniquement les 3 fréquences communiquées :
    // MOUILLAGE, ESPACE CLOS et MÉDICAL sont toutes à 56 jours (8 semaines)
    // sur ce navire, contre 84j/63j sur Meridian. Même semaine de début que
    // Meridian, faute d'information propre à Sirius pour la recalculer.
    Sirius: {
      ABANDON:       { frequence: 30, planning2026: { debut: 2,  intervalle: 4 } },
      INCENDIE:      { frequence: 30, planning2026: { debut: 2,  intervalle: 4 } },
      AVARIE:        { frequence: 84, planning2026: { debut: 7,  intervalle: 12 } },
      ENVAHISSEMENT: { frequence: 84, planning2026: { debut: 8,  intervalle: 12 } },
      MEDICAL:       { frequence: 56, planning2026: { debut: 5,  intervalle: 8 } },
      MOB:           { frequence: 84, planning2026: { debut: 4,  intervalle: 12 } },
      MOUILLAGE:     { frequence: 56, planning2026: { debut: 3,  intervalle: 8 } },
      POLLUTION:     { frequence: 84, planning2026: { debut: 9,  intervalle: 12 } },
      ESPACE_CLOS:   { frequence: 56, planning2026: { debut: 11, intervalle: 8 } },
      LARGAGE:       { frequence: 84, planning2026: { debut: 12, intervalle: 12 } },
      // Pas de DP : exercice non concerné sur Sirius.
    },

    // Planning repris de Meridian pour la fréquence/intervalle (pas de
    // document source propre à Neptune pour l'instant) — ESPACE_CLOS (56j)
    // et MEDICAL (63j) restent comme sur Meridian. DP est concerné ici,
    // fréquence 90j (13 semaines). Les semaines de début sont celles
    // communiquées directement par l'utilisateur pour Neptune (différentes
    // de Meridian).
    Neptune: {
      ABANDON:       { frequence: 30, planning2026: { debut: 1,  intervalle: 4 } },
      INCENDIE:      { frequence: 30, planning2026: { debut: 1,  intervalle: 4 } },
      AVARIE:        { frequence: 84, planning2026: { debut: 6,  intervalle: 12 } },
      ENVAHISSEMENT: { frequence: 84, planning2026: { debut: 6,  intervalle: 12 } },
      MEDICAL:       { frequence: 63, planning2026: { debut: 3,  intervalle: 9 } },
      MOB:           { frequence: 84, planning2026: { debut: 2,  intervalle: 12 } },
      MOUILLAGE:     { frequence: 84, planning2026: { debut: 1,  intervalle: 12 } },
      POLLUTION:     { frequence: 84, planning2026: { debut: 6,  intervalle: 12 } },
      ESPACE_CLOS:   { frequence: 56, planning2026: { debut: 10, intervalle: 8 } },
      LARGAGE:       { frequence: 84, planning2026: { debut: 1,  intervalle: 12 } },
      DP:            { frequence: 90, planning2026: { debut: 2,  intervalle: 13 } },
    },

    // Planning repris de Meridian pour la fréquence/intervalle (pas de
    // document source propre à Atlas pour l'instant). MOUILLAGE, MEDICAL
    // et ESPACE_CLOS sont à 56j (8 semaines). DP n'est pas concerné : il
    // est remplacé par SURETE (84j/12 semaines, réf. réglementaire pas
    // encore communiquée). Semaines de début communiquées directement par
    // l'utilisateur pour Atlas (différentes de Meridian).
    Atlas: {
      ABANDON:       { frequence: 30, planning2026: { debut: 1,  intervalle: 4 } },
      INCENDIE:      { frequence: 30, planning2026: { debut: 1,  intervalle: 4 } },
      AVARIE:        { frequence: 84, planning2026: { debut: 1,  intervalle: 12 } },
      ENVAHISSEMENT: { frequence: 84, planning2026: { debut: 8,  intervalle: 12 } },
      MEDICAL:       { frequence: 56, planning2026: { debut: 10, intervalle: 8 } },
      MOB:           { frequence: 84, planning2026: { debut: 3,  intervalle: 12 } },
      MOUILLAGE:     { frequence: 56, planning2026: { debut: 1,  intervalle: 8 } },
      POLLUTION:     { frequence: 84, planning2026: { debut: 4,  intervalle: 12 } },
      ESPACE_CLOS:   { frequence: 56, planning2026: { debut: 5,  intervalle: 8 } },
      LARGAGE:       { frequence: 84, planning2026: { debut: 9,  intervalle: 12 } },
      SURETE:        { frequence: 84, planning2026: { debut: 7,  intervalle: 12 } },
    },

    // Planning repris de Meridian à l'identique (pas encore de document
    // source propre à Orion/Vega/Polaris) — valeurs provisoires à
    // corriger dès que les fréquences/semaines réelles seront communiquées.
    Orion: {
      ABANDON:       { frequence: 30, planning2026: { debut: 2,  intervalle: 4 } },
      INCENDIE:      { frequence: 30, planning2026: { debut: 2,  intervalle: 4 } },
      AVARIE:        { frequence: 84, planning2026: { debut: 7,  intervalle: 12 } },
      ENVAHISSEMENT: { frequence: 84, planning2026: { debut: 8,  intervalle: 12 } },
      MEDICAL:       { frequence: 63, planning2026: { debut: 5,  intervalle: 9 } },
      MOB:           { frequence: 84, planning2026: { debut: 4,  intervalle: 12 } },
      MOUILLAGE:     { frequence: 84, planning2026: { debut: 3,  intervalle: 12 } },
      POLLUTION:     { frequence: 84, planning2026: { debut: 9,  intervalle: 12 } },
      ESPACE_CLOS:   { frequence: 56, planning2026: { debut: 11, intervalle: 8 } },
      LARGAGE:       { frequence: 84, planning2026: { debut: 12, intervalle: 12 } },
      // Pas de DP sur ce navire.
    },

    Vega: {
      ABANDON:       { frequence: 30, planning2026: { debut: 2,  intervalle: 4 } },
      INCENDIE:      { frequence: 30, planning2026: { debut: 2,  intervalle: 4 } },
      AVARIE:        { frequence: 84, planning2026: { debut: 7,  intervalle: 12 } },
      ENVAHISSEMENT: { frequence: 84, planning2026: { debut: 8,  intervalle: 12 } },
      MEDICAL:       { frequence: 63, planning2026: { debut: 5,  intervalle: 9 } },
      MOB:           { frequence: 84, planning2026: { debut: 4,  intervalle: 12 } },
      MOUILLAGE:     { frequence: 84, planning2026: { debut: 3,  intervalle: 12 } },
      POLLUTION:     { frequence: 84, planning2026: { debut: 9,  intervalle: 12 } },
      ESPACE_CLOS:   { frequence: 56, planning2026: { debut: 11, intervalle: 8 } },
      LARGAGE:       { frequence: 84, planning2026: { debut: 12, intervalle: 12 } },
      // Pas de DP sur ce navire.
    },

    Polaris: {
      ABANDON:       { frequence: 30, planning2026: { debut: 2,  intervalle: 4 } },
      INCENDIE:      { frequence: 30, planning2026: { debut: 2,  intervalle: 4 } },
      AVARIE:        { frequence: 84, planning2026: { debut: 7,  intervalle: 12 } },
      ENVAHISSEMENT: { frequence: 84, planning2026: { debut: 8,  intervalle: 12 } },
      MEDICAL:       { frequence: 63, planning2026: { debut: 5,  intervalle: 9 } },
      MOB:           { frequence: 84, planning2026: { debut: 4,  intervalle: 12 } },
      MOUILLAGE:     { frequence: 84, planning2026: { debut: 3,  intervalle: 12 } },
      POLLUTION:     { frequence: 84, planning2026: { debut: 9,  intervalle: 12 } },
      ESPACE_CLOS:   { frequence: 56, planning2026: { debut: 11, intervalle: 8 } },
      LARGAGE:       { frequence: 84, planning2026: { debut: 12, intervalle: 12 } },
      // Pas de DP sur ce navire.
    },
  },

  // Fusionne le catalogue partagé avec les données du navire donné.
  // Un exercice du catalogue absent des données du navire (ex: DP sur
  // Sirius, non concerné) est exclu du résultat, pas juste affiché vide.
  getExercices(navire) {
    const data = this.NAVIRES_DATA[navire] || {};
    return this.CATALOGUE
      .filter(ex => data[ex.id] !== undefined)
      .map(ex => ({ ...ex, ...data[ex.id] }));
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
