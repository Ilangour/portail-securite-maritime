// ============================================================
//  Contourne l'écran de connexion Google pour les tests automatisés.
//
//  L'authentification (voir portail.js) exige de passer par un vrai
//  compte Google, impossible dans un navigateur headless de test. Poser
//  n'importe quel jeton non vide dans localStorage suffit à passer
//  l'écran de connexion côté client (gate visuel). Côté serveur, ce
//  jeton (TEST_TOKEN) est reconnu comme valide par api/_auth.js, mais
//  uniquement en dehors de Production (voir README.md, section
//  Authentification Google).
// ============================================================
const TEST_TOKEN = 'e2e-test-token';

async function bypassAuth(page) {
  await page.addInitScript((token) => {
    localStorage.setItem('exercices_auth_token', token);
  }, TEST_TOKEN);
}

module.exports = { bypassAuth, TEST_TOKEN };
