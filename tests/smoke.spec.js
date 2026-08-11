// ============================================================
//  Test de fumée (smoke test) — vérifications de base avant
//  chaque déploiement (recette ou production).
//
//  ⚠ Ce test écrit puis supprime un enregistrement réel via le
//  proxy /api/db. Ne JAMAIS faire pointer playwright.config.js
//  (baseURL) vers l'URL de production en l'exécutant.
// ============================================================
const { test, expect } = require('@playwright/test');
const { bypassAuth } = require('./_auth-helper.js');

test.beforeEach(async ({ page }) => { await bypassAuth(page); });

test('la page se charge sans erreur console', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/index.html');
  await expect(page.locator('h1')).toHaveText(/PORTAIL SÉCURITÉ/);
  await page.waitForTimeout(3000); // laisse le temps aux appels Airtable de se terminer

  expect(errors, `Erreurs console : ${errors.join(' | ')}`).toHaveLength(0);
});

test('la navigation entre les 3 pages fonctionne', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForTimeout(2000);

  for (const tab of ['indicateurs', 'historique', 'planning']) {
    await page.click(`.page-tab[data-page="${tab}"]`);
    await expect(page.locator(`#page-${tab}`)).toHaveClass(/active/);
  }
});

test('le formulaire de saisie fonctionne de bout en bout (écriture + suppression)', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForTimeout(2000);

  // Une date future doit être bloquée
  const future = new Date(); future.setDate(future.getDate() + 5);
  await page.selectOption('#sel-exercice', 'ABANDON');
  await page.fill('#date-realisation', future.toISOString().split('T')[0]);
  await expect(page.locator('#btn-submit')).toBeDisabled();
  await expect(page.locator('#form-error')).toBeVisible();

  // Une saisie valide doit s'enregistrer réellement (via le proxy)
  const today = new Date().toISOString().split('T')[0];
  await page.fill('#date-realisation', today);
  await page.click('#btn-submit');
  await expect(page.locator('#toast')).toContainText('enregistré', { timeout: 5000 });

  // Nettoyage : on annule immédiatement cette saisie de test
  await expect(page.locator('#last-entry-box')).toBeVisible();
  await page.click('#btn-undo');
  await expect(page.locator('#toast')).toContainText('annulée', { timeout: 5000 });
});
