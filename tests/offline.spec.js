// ============================================================
//  Test du mode hors-ligne — simule une coupure réseau au moment
//  de la soumission, puis le retour du réseau et le renvoi manuel.
//
//  ⚠ Ce test écrit puis supprime un enregistrement réel via le
//  proxy /api/db (au retour réseau). Ne JAMAIS faire pointer
//  playwright.config.js (baseURL) vers l'URL de production.
// ============================================================
const { test, expect } = require('@playwright/test');
const { bypassAuth, TEST_TOKEN } = require('./_auth-helper.js');

test.beforeEach(async ({ page }) => { await bypassAuth(page); });

test('soumission hors-ligne : brouillon créé et bandeau affiché', async ({ page, context }) => {
  await page.goto('/index.html');
  await page.waitForTimeout(2000);
  await page.evaluate(() => localStorage.removeItem('exercices_drafts_v1'));

  await context.setOffline(true);
  await page.selectOption('#sel-exercice', 'ABANDON');
  const today = new Date().toISOString().split('T')[0];
  await page.fill('#date-realisation', today);
  await page.click('#btn-submit');

  await expect(page.locator('#toast')).toContainText('brouillon', { timeout: 5000 });
  await expect(page.locator('#drafts-banner')).toBeVisible();
  await expect(page.locator('#drafts-banner-text')).toContainText('1 brouillon en attente');

  const draftsCount = await page.evaluate(() => getDrafts().length);
  expect(draftsCount).toBe(1);

  await context.setOffline(false);
});

test('retour réseau : le renvoi manuel envoie le brouillon et vide le bandeau', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForTimeout(2000);
  await page.evaluate(() => localStorage.removeItem('exercices_drafts_v1'));

  // Prépare un brouillon directement (sans repasser par la coupure réseau,
  // déjà couverte par le test précédent) pour isoler le comportement du renvoi.
  await page.evaluate(() => {
    saveDraft({
      Navire: 'Aurore', Type_Exercice: 'ABANDON', Nom_Exercice: 'ABANDON',
      Date_Realisation: new Date().toISOString().split('T')[0],
      Semaine: 1, Annee: new Date().getFullYear(),
      Source: 'Manuel', Saisi_Par: '', Observations: ''
    });
  });
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(page.locator('#drafts-banner')).toBeVisible();

  await page.click('#btn-resend-drafts');
  await expect(page.locator('#toast')).toContainText('envoyé', { timeout: 5000 });
  await expect(page.locator('#drafts-banner')).toBeHidden();

  const draftsCount = await page.evaluate(() => getDrafts().length);
  expect(draftsCount).toBe(0);

  // Nettoyage : suppression réelle de l'enregistrement créé par le renvoi
  const recordId = await page.evaluate(() => allExRecords[allExRecords.length - 1].id);
  const del = await page.evaluate(async ({ id, token }) => {
    const res = await fetch(`/api/db?id=${id}`, {
      method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.ok;
  }, { id: recordId, token: TEST_TOKEN });
  expect(del).toBe(true);
});
