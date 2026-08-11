// ============================================================
//  Test de non-régression XSS — l'Historique affiche des champs
//  Airtable en texte libre (Observations, Saisi_Par, Nom_Exercice).
//  Un contenu malveillant dans ces champs ne doit jamais s'exécuter,
//  seulement s'afficher tel quel (échappé).
//
//  ⚠ Ce test écrit puis supprime un enregistrement réel via le
//  proxy /api/db. Ne JAMAIS faire pointer playwright.config.js
//  (baseURL) vers l'URL de production.
// ============================================================
const { test, expect } = require('@playwright/test');
const { bypassAuth, TEST_TOKEN } = require('./_auth-helper.js');

test.beforeEach(async ({ page }) => { await bypassAuth(page); });

test('un champ Observations malveillant ne s\'exécute pas et s\'affiche échappé', async ({ page }) => {
  let dialogFired = false;
  page.on('dialog', async d => { dialogFired = true; await d.dismiss(); });

  const payload = '<img src=x onerror="window.__xss_triggered = true">';
  const today = new Date().toISOString().split('T')[0];

  await page.goto('/index.html');
  await page.waitForTimeout(1500);

  // Création directe via le proxy (comme le ferait n'importe quel appelant,
  // vu que le formulaire lui-même ne permet pas de saisir Observations)
  const created = await page.evaluate(async ({ payload, today, token }) => {
    const res = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ fields: {
        Navire: 'Aurore', Type_Exercice: 'ABANDON', Nom_Exercice: 'ABANDON',
        Date_Realisation: today, Semaine: 1, Annee: new Date().getFullYear(),
        Source: 'Manuel', Saisi_Par: payload, Observations: payload,
      }}),
    });
    const data = await res.json();
    return data.id;
  }, { payload, today, token: TEST_TOKEN });

  await page.reload();
  await page.waitForTimeout(2000);
  await page.click('.page-tab[data-page="historique"]');
  await page.waitForTimeout(500);

  const triggered = await page.evaluate(() => window.__xss_triggered === true);
  expect(triggered, 'le payload ne doit jamais s\'exécuter').toBe(false);
  expect(dialogFired, 'aucune boîte de dialogue ne doit apparaître').toBe(false);

  // Le texte doit être visible tel quel (échappé), pas interprété comme balise
  await expect(page.locator('#historique-tbody')).toContainText(payload);
  const imgCount = await page.locator('#historique-tbody img').count();
  expect(imgCount, 'aucune balise <img> réelle ne doit avoir été injectée').toBe(0);

  // Nettoyage
  const del = await page.evaluate(async ({ id, token }) => {
    const res = await fetch(`/api/db?id=${id}`, {
      method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.ok;
  }, { id: created, token: TEST_TOKEN });
  expect(del).toBe(true);
});
