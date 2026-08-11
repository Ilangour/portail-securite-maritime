// ============================================================
//  portail.js — Portail unifié Sécurité Maritime
//  Auto-refresh toutes les 2 minutes
// ============================================================

// Le token et l'ID de base ne sont plus connus du navigateur : toutes les
// requêtes passent par le proxy serveur /api/db (voir api/db.js), qui les
// résout côté serveur à partir des variables d'environnement Vercel.
const API_EX = `/api/db`;

// Fonction (pas une constante) : le jeton n'est connu qu'après connexion
// Google (voir authToken plus bas), donc il faut le lire à chaque appel.
function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` };
}

let chartHisto    = null;
let allExRecords  = [];
let lastDates     = {};
let selectedEx    = null;
let currentYear   = new Date().getFullYear();
let currentNavire = CONFIG.NAVIRES[0] || '';
let currentExercices = CONFIG.getExercices(currentNavire); // catalogue + fréquences/planning du navire courant
let refreshTimer  = null;
let formVisible   = true;
let lastEntry     = null; // dernière saisie enregistrée, pour annulation

const REFRESH_MS  = 2 * 60 * 1000; // 2 minutes

// ================================================================
//  AUTHENTIFICATION GOOGLE
//
//  Gate visuel + jeton envoyé sur chaque appel API (voir authHeaders).
//  La vraie protection (vérification de signature, domaine autorisé) se
//  fait côté serveur dans api/_auth.js, appelé par api/db.js — voir
//  README.md.
// ================================================================
const AUTH_TOKEN_KEY = 'exercices_auth_token';
let authToken   = null;
let appStarted  = false;

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
});

function initAuth() {
  const stored = localStorage.getItem(AUTH_TOKEN_KEY);
  if (stored && !appStarted) {
    authToken = stored;
    startApp();
  }

  if (typeof google === 'undefined' || !google.accounts) {
    // Google Identity Services (script async) pas encore chargé : réessaie.
    setTimeout(initAuth, 200);
    return;
  }

  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse,
  });
  google.accounts.id.renderButton(
    document.getElementById('google-signin-button'),
    { theme: 'outline', size: 'large', text: 'signin_with' }
  );

  if (!appStarted) {
    document.getElementById('login-overlay').classList.add('active');
  }
}

function handleCredentialResponse(response) {
  authToken = response.credential;
  localStorage.setItem(AUTH_TOKEN_KEY, authToken);
  document.getElementById('login-error').classList.add('hidden');
  startApp();
}

function startApp() {
  document.getElementById('login-overlay').classList.remove('active');
  document.getElementById('app-root').classList.remove('app-hidden');
  if (appStarted) return; // reconnexion après expiration : ne pas ré-initialiser
  appStarted = true;
  initHeader();
  initForm();
  initPageNav();
  initHistoriqueDelete();
  initHistoriqueFilter();
  loadAll();
  startAutoRefresh();
}

// Jeton expiré (ou révoqué) détecté par le serveur (401) : redemande une
// connexion, sans perdre l'état déjà initialisé de la page.
function handleAuthExpired() {
  authToken = null;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  document.getElementById('app-root').classList.add('app-hidden');
  const err = document.getElementById('login-error');
  err.textContent = 'Session expirée — merci de vous reconnecter.';
  err.classList.remove('hidden');
  document.getElementById('login-overlay').classList.add('active');
}

// Wrapper commun à tous les appels API : ajoute le jeton et détecte une
// session expirée (401) au même endroit pour tous les appelants.
async function apiFetch(url, options = {}) {
  const res = await fetch(url, { ...options, headers: authHeaders() });
  if (res.status === 401) {
    handleAuthExpired();
    const err = new Error('Session expirée — merci de vous reconnecter.');
    err.isAuthError = true;
    throw err;
  }
  return res;
}

// ================================================================
//  NAVIGATION PAR PAGES
// ================================================================
function initPageNav() {
  document.querySelectorAll('.page-tab').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });
  showPage('planning');
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.page-tab').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  document.querySelector(`.page-tab[data-page="${name}"]`).classList.add('active');
}

function initHeader() {
  const selN = document.getElementById('sel-navire');
  CONFIG.NAVIRES.forEach(n => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    selN.appendChild(o);
  });
  selN.addEventListener('change', e => {
    currentNavire = e.target.value;
    currentExercices = CONFIG.getExercices(currentNavire);
    populateExerciceSelect();
    populateHistoriqueFilterSelect();
    onExerciceChange(); // réinitialise la sélection d'exercice affichée (catalogue changé)
    loadAll();
  });

  const selA = document.getElementById('sel-annee');
  CONFIG.ANNEES.forEach(y => {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    if (y === currentYear) o.selected = true;
    selA.appendChild(o);
  });
  selA.addEventListener('change', e => { currentYear = +e.target.value; loadAll(); });

  document.getElementById('btn-refresh').addEventListener('click', () => loadAll(true));

  // Date du jour par défaut
  document.getElementById('date-realisation').value = new Date().toISOString().split('T')[0];
}

// ================================================================
//  AUTO-REFRESH
// ================================================================
function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadAll(), REFRESH_MS);
}

function setRefreshing(on) {
  const dot = document.getElementById('pulse-dot');
  const btn = document.getElementById('btn-refresh');
  dot.className = on ? 'pulse updating' : 'pulse';
  btn.className = on ? 'refresh-btn spinning' : 'refresh-btn';
}

function setLastUpdate() {
  const now = new Date();
  document.getElementById('last-update').textContent =
    `MAJ ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  document.getElementById('header-sub').textContent =
    `${currentNavire} — ${currentYear}  ·  S${isoWeek(now)} · ${now.toLocaleDateString('fr-FR')}`;
}

// ================================================================
//  CHARGEMENT GLOBAL
// ================================================================
// Jeton de séquence : un clic rapide sur "Actualiser" pendant qu'un appel
// précédent est encore en vol (ou une collision avec le rafraîchissement
// automatique) ne doit pas laisser la réponse la plus lente écraser
// l'affichage après que la plus récente a déjà rendu — seul le dernier
// appel lancé est autorisé à mettre à jour l'écran.
let loadSeq = 0;
async function loadAll(manual = false) {
  const seq = ++loadSeq;
  setRefreshing(true);
  if (manual) startAutoRefresh(); // repart le timer

  try {
    const records = await fetchExercices();
    if (seq !== loadSeq) return; // une exécution plus récente a déjà pris le dessus
    allExRecords = records;
    buildLastDates();
    renderDashboard();
    setLastUpdate();

  } catch (e) {
    console.error('Erreur chargement:', e);
    showToast('⚠ Erreur de connexion au serveur', 'err');
  } finally {
    if (seq === loadSeq) setRefreshing(false);
  }
}

// ================================================================
//  API FETCH
// ================================================================
async function fetchExercices() {
  const formula = encodeURIComponent(`AND({Navire}='${currentNavire}',{Annee}=${currentYear})`);
  let records = [], offset = null;
  do {
    let url = `${API_EX}?filterByFormula=${formula}&sort[0][field]=Date_Realisation&sort[0][direction]=desc&pageSize=100`;
    if (offset) url += `&offset=${offset}`;
    const res  = await apiFetch(url);
    if (!res.ok) throw new Error(`Exercices HTTP ${res.status}`);
    const data = await res.json();
    records = records.concat(data.records || []);
    offset  = data.offset || null;
  } while (offset);
  return records;
}

// ================================================================
//  BROUILLONS HORS-LIGNE
//
//  Quand l'enregistrement échoue faute de réseau (voir doSubmit), la saisie
//  est conservée ici plutôt que perdue. Renvoi manuel uniquement (bouton
//  "Renvoyer"), jamais automatique — voir renderDraftsBanner/resendDrafts.
// ================================================================
const DRAFTS_KEY = 'exercices_drafts_v1';

function getDrafts() {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveDraftsList(drafts) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

function saveDraft(fields) {
  const drafts = getDrafts();
  const draft = {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fields,
    savedAt: new Date().toISOString(),
    error: null
  };
  drafts.push(draft);
  saveDraftsList(drafts);
  return draft;
}

function removeDraft(draftId) {
  saveDraftsList(getDrafts().filter(d => d.id !== draftId));
}

function setDraftError(draftId, message) {
  const drafts = getDrafts();
  const draft  = drafts.find(d => d.id === draftId);
  if (draft) { draft.error = message; saveDraftsList(drafts); }
}

function renderDraftsBanner() {
  const banner = document.getElementById('drafts-banner');
  const text   = document.getElementById('drafts-banner-text');
  const drafts = getDrafts();
  if (!drafts.length) { banner.classList.add('hidden'); return; }
  const withError = drafts.filter(d => d.error).length;
  text.textContent = `⚠ ${drafts.length} brouillon${drafts.length > 1 ? 's' : ''} en attente d'envoi` +
    (withError ? ` (${withError} en échec)` : '');
  banner.classList.remove('hidden');
}

// Renvoi manuel (jamais automatique) : chaque brouillon est renvoyé un par un
// vers le serveur. Un brouillon qui échoue à nouveau (réseau ou erreur API)
// reste en attente avec son message d'erreur — jamais supprimé silencieusement.
async function resendDrafts() {
  const btn = document.getElementById('btn-resend-drafts');
  btn.disabled = true;
  btn.textContent = '…';

  const drafts = getDrafts();
  let okCount = 0, failCount = 0;

  for (const draft of drafts) {
    try {
      const res = await apiFetch(API_EX, {
        method: 'POST',
        body: JSON.stringify({ fields: draft.fields })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Erreur serveur (HTTP ${res.status})`);
      }
      const data = await res.json();
      allExRecords.push({ id: data.id, fields: draft.fields });
      removeDraft(draft.id);
      okCount++;
    } catch (e) {
      setDraftError(draft.id, e.message || 'Échec de l\'envoi');
      failCount++;
      // Session expirée : apiFetch a déjà affiché l'écran de connexion —
      // inutile (et voué à l'échec) d'essayer les brouillons restants avec
      // un jeton devenu invalide, ça ne fait que multiplier les échecs.
      if (e.isAuthError) break;
    }
  }

  if (okCount)   showToast(`✓ ${okCount} brouillon${okCount > 1 ? 's' : ''} envoyé${okCount > 1 ? 's' : ''}`, 'ok');
  if (failCount) showToast(`✗ ${failCount} brouillon${failCount > 1 ? 's' : ''} toujours en échec`, 'err');

  if (okCount) { buildLastDates(); renderDashboard(); }
  renderDraftsBanner();
  btn.disabled = false;
  btn.textContent = '↻ Renvoyer';
}

// ================================================================
//  FORMULAIRE DE SAISIE (simplifié : exercice + date)
// ================================================================
function initForm() {
  populateExerciceSelect();
  document.getElementById('sel-exercice').addEventListener('change', onExerciceChange);
  document.getElementById('date-realisation').addEventListener('change', updateSubmit);
  document.getElementById('btn-submit').addEventListener('click', doSubmit);
  document.getElementById('btn-undo').addEventListener('click', undoLastEntry);
  document.getElementById('btn-resend-drafts').addEventListener('click', resendDrafts);
  renderDraftsBanner();
}

function populateExerciceSelect() {
  const sel = document.getElementById('sel-exercice');
  sel.querySelectorAll('option:not([value=""])').forEach(o => o.remove());
  currentExercices.forEach(ex => {
    const o = document.createElement('option');
    o.value = ex.id; o.textContent = `${ex.icon} ${ex.nom}`;
    sel.appendChild(o);
  });
}

// eslint-disable-next-line no-unused-vars -- appelée depuis onclick="toggleForm()" dans index.html
function toggleForm() {
  formVisible = !formVisible;
  document.getElementById('form-body').style.display = formVisible ? '' : 'none';
  document.getElementById('toggle-form-btn').textContent = formVisible ? '▲ Masquer' : '▼ Saisir un exercice';
}

function buildLastDates() {
  lastDates = {};
  allExRecords.forEach(rec => {
    const id   = rec.fields.Type_Exercice;
    const date = new Date(rec.fields.Date_Realisation + 'T12:00:00');
    if (!lastDates[id] || date > lastDates[id]) lastDates[id] = date;
  });
}

function onExerciceChange() {
  const id = document.getElementById('sel-exercice').value;
  selectedEx = currentExercices.find(e => e.id === id) || null;

  const refBox = document.getElementById('ref-inline');
  if (!selectedEx) { refBox.classList.add('hidden'); updateSubmit(); return; }

  const last  = lastDates[selectedEx.id];
  const today = new Date();
  let nextTxt = '';
  if (last && selectedEx.frequence) {
    const next = new Date(last);
    next.setDate(next.getDate() + selectedEx.frequence);
    const j = Math.ceil((next - today) / 864e5);
    nextTxt = ` · Prochain avant : <strong>${next.toLocaleDateString('fr-FR')}</strong> (${j >= 0 ? '+' : ''}${j}j)`;
  }
  const freqTxt = selectedEx.frequence ? `${selectedEx.frequence} j` : 'non définie';
  refBox.innerHTML = `📋 <strong>${selectedEx.nom}</strong> — Réf. : <em>${selectedEx.ref}</em> — Fréquence : ${freqTxt}${nextTxt}`;
  refBox.classList.remove('hidden');
  updateSubmit();
}

function updateSubmit() {
  const dateStr  = document.getElementById('date-realisation').value;
  const errorBox = document.getElementById('form-error');
  const btn      = document.getElementById('btn-submit');

  if (dateStr && isFutureDate(dateStr)) {
    errorBox.textContent = '✗ La date de réalisation ne peut pas être dans le futur.';
    errorBox.classList.remove('hidden');
    btn.disabled = true;
    return;
  }
  errorBox.classList.add('hidden');
  btn.disabled = !(dateStr && selectedEx);
}

function isFutureDate(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const date  = new Date(dateStr + 'T00:00:00');
  return date > today;
}

async function doSubmit() {
  const date = document.getElementById('date-realisation').value;
  if (!date || !selectedEx || isFutureDate(date)) return;

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>';

  const dateObj = new Date(date + 'T12:00:00');
  const fields  = {
    Navire: currentNavire, Type_Exercice: selectedEx.id,
    Nom_Exercice: selectedEx.nom, Date_Realisation: date,
    Semaine: isoWeek(dateObj), Annee: dateObj.getFullYear(),
    Source: 'Manuel', Saisi_Par: '', Observations: ''
  };

  let res;
  try {
    res = await apiFetch(API_EX, {
      method: 'POST',
      body: JSON.stringify({ fields })
    });
  } catch (e) {
    if (e.isAuthError) {
      showToast(`✗ ${e.message}`, 'err');
      btn.disabled = false;
      btn.textContent = '✓ Enregistrer';
      updateSubmit();
      return;
    }
    // fetch rejette uniquement en cas de panne réseau (pas de réponse HTTP du tout) :
    // la saisie part en brouillon local plutôt que d'être perdue.
    saveDraft(fields);
    renderDraftsBanner();
    showToast(`⚠ Pas de réseau : saisie conservée en brouillon (renvoi manuel).`, 'err');
    document.getElementById('sel-exercice').value = '';
    selectedEx = null;
    document.getElementById('ref-inline').classList.add('hidden');
    document.getElementById('date-realisation').value = new Date().toISOString().split('T')[0];
    btn.disabled = false;
    btn.textContent = '✓ Enregistrer';
    updateSubmit();
    return;
  }

  try {
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Erreur serveur (HTTP ${res.status})`);
    }
    const data = await res.json();

    allExRecords.push({ id: data.id, fields });

    showToast(`✓ ${selectedEx.nom} — Semaine ${fields.Semaine} enregistré`, 'ok');
    showLastEntry(data.id, selectedEx, fields);

    // Reset du formulaire
    document.getElementById('sel-exercice').value = '';
    selectedEx = null;
    document.getElementById('ref-inline').classList.add('hidden');
    document.getElementById('date-realisation').value = new Date().toISOString().split('T')[0];

    buildLastDates();
    renderDashboard();
  } catch (e) {
    showToast(`✗ Enregistrement refusé : ${e.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '✓ Enregistrer';
    updateSubmit();
  }
}

// ================================================================
//  ANNULATION DE LA DERNIÈRE SAISIE
// ================================================================
function showLastEntry(recordId, ex, fields) {
  lastEntry = { recordId, ex, fields };
  const box  = document.getElementById('last-entry-box');
  const date = new Date(fields.Date_Realisation + 'T12:00:00').toLocaleDateString('fr-FR');
  document.getElementById('last-entry-text').innerHTML =
    `↳ Dernière saisie : <strong>${ex.icon} ${ex.nom}</strong> — ${date} (Semaine ${fields.Semaine})`;
  box.classList.remove('hidden');
}

async function undoLastEntry() {
  if (!lastEntry) return;
  const btn = document.getElementById('btn-undo');
  btn.disabled = true;
  btn.textContent = '…';

  try {
    const res = await apiFetch(`${API_EX}?id=${lastEntry.recordId}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message); }
    allExRecords = allExRecords.filter(r => r.id !== lastEntry.recordId);

    showToast(`↩ Saisie annulée : ${lastEntry.ex.nom} — Semaine ${lastEntry.fields.Semaine}`, 'ok');
    document.getElementById('last-entry-box').classList.add('hidden');
    lastEntry = null;

    buildLastDates();
    renderDashboard();
  } catch (e) {
    showToast(`✗ Impossible d'annuler : ${e.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '↩ Annuler cette saisie';
  }
}

// ================================================================
//  PROCHAIN EXERCICE À FAIRE
// ================================================================
const PROCHAIN_SEUIL_JOURS = 7;

function renderNextExercice(today) {
  const body = document.getElementById('next-ex-body');

  const candidats = [];
  currentExercices.forEach(ex => {
    const last = lastDates[ex.id];
    let jours;
    if (last) {
      if (!ex.frequence) return; // fréquence non définie : pas de prochaine échéance calculable
      const next = new Date(last);
      next.setDate(next.getDate() + ex.frequence);
      jours = Math.ceil((next - today) / 864e5);
    } else {
      jours = -Infinity; // jamais réalisé = priorité maximale
    }
    if (jours <= PROCHAIN_SEUIL_JOURS) candidats.push({ ex, jours, last });
  });

  if (!candidats.length) {
    body.innerHTML = `<p class="muted">✓ Aucune échéance sous ${PROCHAIN_SEUIL_JOURS} jours</p>`;
    return;
  }

  candidats.sort((a, b) => a.jours - b.jours);

  body.innerHTML = `
    <div class="quick-status-grid">
      ${candidats.map(({ ex, jours, last }) => {
        let badge, cls;
        if (!last) {
          badge = '⚠ Jamais réalisé'; cls = 'red';
        } else if (jours < 0) {
          badge = `⚠ En retard de ${Math.abs(jours)} j`; cls = 'red';
        } else {
          badge = `⏱ Dans ${jours} j`; cls = 'orange';
        }
        return `
          <div class="quick-card ${cls}">
            <div class="q-icon" style="font-size:32px">${ex.icon}</div>
            <div class="q-info">
              <div class="q-nom" style="font-size:14px">${ex.nom}</div>
              <div class="q-stat" style="color:var(--${cls});font-size:14px">${badge}</div>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

// ================================================================
//  DASHBOARD EXERCICES
// ================================================================
function renderDashboard() {
  const today     = new Date();
  const todayWeek = isoWeek(today);

  // Index données
  const doneByType  = {};
  allExRecords.forEach(rec => {
    const id   = rec.fields.Type_Exercice;
    const date = new Date(rec.fields.Date_Realisation + 'T12:00:00');
    if (!doneByType[id]) doneByType[id] = [];
    doneByType[id].push(date);
  });

  const plannedWeeks = {}, doneWeeks = {};
  currentExercices.forEach(ex => {
    plannedWeeks[ex.id] = computePlannedWeeks(ex, currentYear);
    doneWeeks[ex.id]    = new Set((doneByType[ex.id] || []).map(d => isoWeek(d)));
  });

  const analysis = {};
  currentExercices.forEach(ex => {
    analysis[ex.id] = analyzeExercise(plannedWeeks[ex.id], doneWeeks[ex.id], todayWeek);
  });

  const stats = {};
  currentExercices.forEach(ex => {
    const pw    = plannedWeeks[ex.id];
    const dw    = doneWeeks[ex.id];
    const dones = doneByType[ex.id] || [];
    const plannedSoFar = [...pw].filter(w => w <= todayWeek).length;
    const realise       = dones.length;
    // Conforme = correspondance EXACTE semaine planifiée / semaine réalisée,
    // identique à ce qu'affiche le planning (case verte PR) — pas une simple
    // proximité ±1 semaine, qui surcomptait pour les exercices très fréquents.
    const conforme = [...pw].filter(w => dw.has(w)).length;
    // Manquant = semaines planifiées jamais rattrapées (ni à temps, ni en retard)
    const manquant = analysis[ex.id].missing;
    const taux     = plannedSoFar > 0 ? realise / plannedSoFar : null;
    stats[ex.id]   = { plannedSoFar, realise, conforme, manquant, taux };
  });

  renderQuickStatus(today);
  renderNextExercice(today);
  renderKPIs(stats, today);
  renderStatusTable(today);
  renderStatsTable(stats);
  renderChart(stats);
  renderPlanningGrid(plannedWeeks, doneWeeks, todayWeek);
  renderHistorique(plannedWeeks);
}

// ---- Cartes rapides RAG ----
function renderQuickStatus(today) {
  const grid = document.getElementById('quick-status');
  grid.innerHTML = '';

  currentExercices.forEach(ex => {
    const last = lastDates[ex.id];
    const { state, daysLeft } = computeRegulatoryStatus(ex, last, today);
    let cls = '', statTxt = 'Non renseigné';

    if (state === 'no-frequency') {
      statTxt = 'Fréquence non définie';
    } else if (state === 'late') {
      cls = 'red';
      statTxt = `En retard ${Math.abs(daysLeft)} j`;
    } else if (state === 'warning') {
      cls = 'orange';
      statTxt = `Dans ${daysLeft} j`;
    } else if (state === 'ok') {
      statTxt = `✓ Dans ${daysLeft} j`;
    } else {
      cls = 'red';
    }

    const card = document.createElement('div');
    card.className = `quick-card ${cls}`;
    card.innerHTML = `
      <div class="q-icon">${ex.icon}</div>
      <div class="q-info">
        <div class="q-nom">${ex.nom}</div>
        <div class="q-stat" style="color:var(--${cls || 'green'})">${statTxt}</div>
      </div>`;
    grid.appendChild(card);
  });
}

// ---- KPI globaux ----
function renderKPIs(stats, today) {
  const { conformite, manqPct, ratio, totReal, ajourPct, retards, retardCls } =
    computeKPIs(currentExercices, stats, lastDates, today);
  document.getElementById('kpi-conformite').textContent = `${conformite}%`;
  document.getElementById('kpi-manquants').textContent  = `${manqPct}%`;
  document.getElementById('kpi-ratio').textContent      = `${ratio}%`;
  document.getElementById('kpi-total').textContent      = totReal;

  document.getElementById('kpi-retards').textContent = `${ajourPct}%`;
  document.getElementById('kpi-retards-label').textContent =
    retards === 0 ? 'À jour réglementairement' : `À jour réglementairement (${retards} en retard)`;

  const card = document.getElementById('kpi-retards-card');
  const val  = document.getElementById('kpi-retards');
  card.classList.remove('green', 'orange', 'red');
  val.classList.remove('green', 'orange', 'red');
  card.classList.add(retardCls);
  val.classList.add(retardCls);
}

// ---- Tableau réglementaire ----
function renderStatusTable(today) {
  const tbody = document.getElementById('status-tbody');
  tbody.innerHTML = '';
  currentExercices.forEach(ex => {
    const last = lastDates[ex.id];
    const tr   = document.createElement('tr');
    const { state, daysLeft, nextDate } = computeRegulatoryStatus(ex, last, today);
    let badgeHtml = '<span class="badge badge-grey">Non renseigné</span>';
    let joursHtml = '—';
    let rowBg     = '';

    if (state === 'no-frequency') {
      badgeHtml = '<span class="badge badge-grey">Fréquence non définie</span>';
    } else if (state === 'late') {
      badgeHtml = `<span class="badge badge-red">⚠ Retard ${Math.abs(daysLeft)} j</span>`;
      joursHtml = `<strong style="color:var(--red)">${daysLeft}</strong>`;
      rowBg = '#fff5f5';
    } else if (state === 'warning') {
      badgeHtml = `<span class="badge badge-orange">⏱ ${daysLeft} j</span>`;
      joursHtml = `<strong style="color:var(--orange)">+${daysLeft}</strong>`;
      rowBg = '#fffbf0';
    } else if (state === 'ok') {
      badgeHtml = `<span class="badge badge-green">✓ ${daysLeft} j</span>`;
      joursHtml = `<span style="color:var(--green)">+${daysLeft}</span>`;
    } else { rowBg = '#fff5f5'; badgeHtml = '<span class="badge badge-red">⚠ Jamais réalisé</span>'; }

    if (rowBg) tr.style.background = rowBg;
    tr.innerHTML = `
      <td><strong>${ex.icon} ${ex.nom}</strong></td>
      <td><span class="small muted">${ex.ref}</span></td>
      <td style="text-align:center">${ex.frequence ?? '—'}</td>
      <td>${last ? last.toLocaleDateString('fr-FR') : '—'}</td>
      <td>${nextDate ? nextDate.toLocaleDateString('fr-FR') : '—'}</td>
      <td style="text-align:center">${joursHtml}</td>
      <td>${badgeHtml}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('status-loading').classList.add('hidden');
  document.getElementById('status-table').classList.remove('hidden');
}

// ---- Stats ----
function renderStatsTable(stats) {
  const tbody = document.getElementById('stats-tbody');
  tbody.innerHTML = '';
  currentExercices.forEach(ex => {
    const s   = stats[ex.id];
    const pct = s.taux !== null ? Math.round(s.taux * 100) : null;
    const cls = pct === null ? '' : pct >= 100 ? 'color:var(--green)' : pct >= 80 ? 'color:var(--orange)' : 'color:var(--red)';
    const tr  = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${ex.nom}</strong></td>
      <td class="tr">${s.plannedSoFar}</td>
      <td class="tr">${s.realise}</td>
      <td class="tr">${s.conforme}</td>
      <td class="tr">${s.manquant > 0 ? `<strong style="color:var(--red)">${s.manquant}</strong>` : '0'}</td>
      <td class="tr"><strong style="${cls}">${pct !== null ? pct + '%' : '—'}</strong></td>`;
    tbody.appendChild(tr);
  });
}

// ---- Histogramme (barres empilées à 100%, comme le fichier Excel) ----
function renderChart(stats) {
  const labels = currentExercices.map(ex => ex.nom === 'LARGAGE-REMORQUAGE URGENCE' ? 'LARGAGE' : ex.nom);

  const segments = computeChartSegments(currentExercices, stats);
  const pct = key => segments.map(s => s[key]);

  if (chartHisto) chartHisto.destroy();
  const ctx = document.getElementById('chart-histo').getContext('2d');
  chartHisto = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Réalisé',  data: pct('realise'),  backgroundColor: 'rgba(21,101,192,.85)', borderColor: '#1565c0', borderWidth: 1 },
        { label: 'Conforme', data: pct('conforme'), backgroundColor: 'rgba(46,125,50,.85)',  borderColor: '#2e7d32', borderWidth: 1 },
        { label: 'Manquant', data: pct('manquant'), backgroundColor: 'rgba(198,40,40,.85)',  borderColor: '#c62828', borderWidth: 1 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => currentExercices[items[0].dataIndex].nom,
            label: item => `${item.dataset.label} : ${item.raw}%`
          }
        }
      },
      scales: {
        x: { stacked: true, ticks: { font: { size: 10 }, maxRotation: 40 } },
        y: { stacked: true, min: 0, max: 100, ticks: { stepSize: 25, callback: v => v + '%' } }
      }
    }
  });
}

// ---- Grille planning ----
function renderPlanningGrid(plannedWeeks, doneWeeks, todayWeek) {
  const wrap  = document.getElementById('planning-wrap');
  const table = document.createElement('table');
  table.className = 'planning-table';
  const thead = document.createElement('thead');
  let hRow = '<tr><th class="th-label">Exercice</th>';
  for (let w = 1; w <= 53; w++) {
    hRow += `<th class="${w === todayWeek ? 'cell-now' : ''}">${w}</th>`;
  }
  thead.innerHTML = hRow + '</tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  currentExercices.forEach(ex => {
    const pw = plannedWeeks[ex.id], dw = doneWeeks[ex.id];
    const tr = document.createElement('tr');
    let row  = `<td class="row-label">${ex.icon} ${ex.nom}</td>`;
    for (let w = 1; w <= 53; w++) {
      const isP = pw.has(w), isR = dw.has(w), isCur = w === todayWeek;
      let cls = '', txt = '';
      if (isP && isR)   { cls = 'cell-PR'; txt = 'PR'; }
      else if (isP)     { cls = 'cell-P';  txt = 'P'; }
      else if (isR)     { cls = 'cell-R';  txt = 'R'; }
      if (isCur) cls += ' cell-now';
      row += `<td class="${cls.trim()}">${txt}</td>`;
    }
    tr.innerHTML = row;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.innerHTML = '';
  wrap.appendChild(table);
}

// ---- Historique ----
function renderHistorique(plannedWeeks) {
  const tbody = document.getElementById('historique-tbody');
  if (!allExRecords.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted loading">Aucun exercice enregistré pour cette période.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  allExRecords.forEach(rec => {
    const f    = rec.fields;
    const date = new Date(f.Date_Realisation + 'T12:00:00');
    const week = f.Semaine || isoWeek(date);
    const ex   = currentExercices.find(e => e.id === f.Type_Exercice);
    let confBadge = '—';
    if (ex) {
      const pw = plannedWeeks[ex.id];
      // Correspondance EXACTE semaine planifiée / semaine réalisée — même
      // règle que "conforme" dans renderDashboard (voir son commentaire) et
      // que la case verte du planning, pour que Historique et Indicateurs
      // racontent la même histoire sur un même enregistrement.
      const ok = pw.has(week);
      confBadge = ok
        ? '<span class="badge badge-green">✓ Conforme</span>'
        : '<span class="badge badge-orange">Hors planning</span>';
    }
    const tr = document.createElement('tr');
    tr.dataset.exercice = f.Type_Exercice;
    tr.dataset.search = [
      ex ? ex.nom : f.Type_Exercice, f.Saisi_Par, f.Observations, f.Source,
      date.toLocaleDateString('fr-FR')
    ].filter(Boolean).join(' ').toLowerCase();
    tr.innerHTML = `
      <td>${date.toLocaleDateString('fr-FR')}</td>
      <td style="text-align:center">${week}</td>
      <td><strong>${ex ? ex.icon + ' ' : ''}${escapeHtml(f.Nom_Exercice || f.Type_Exercice)}</strong></td>
      <td>${confBadge}</td>
      <td>${f.Source === 'SafetyCulture'
        ? `<span class="badge badge-blue">${escapeHtml(f.Source)}</span>`
        : `<span class="muted">${escapeHtml(f.Source) || '—'}</span>`}</td>
      <td>${escapeHtml(f.Saisi_Par) || '—'}</td>
      <td><span class="muted small">${escapeHtml(f.Observations) || '—'}</span></td>
      <td style="text-align:center">
        ${f.Lien_Inspection && f.Lien_Inspection.startsWith('https://')
          ? `<a href="${escapeHtml(f.Lien_Inspection)}" target="_blank" rel="noopener" title="Voir l'inspection SafetyCulture">🔗</a>`
          : ''}
        <button class="btn-delete-histo" title="Supprimer cet enregistrement"
                data-record-id="${escapeHtml(rec.id)}"
                data-record-label="${escapeHtml(ex ? ex.nom : f.Type_Exercice)} — ${date.toLocaleDateString('fr-FR')}">
          🗑️
        </button>
      </td>`;
    tbody.appendChild(tr);
  });
  applyHistoriqueFilter();
}

// ================================================================
//  RECHERCHE / FILTRE HISTORIQUE
// ================================================================
function initHistoriqueFilter() {
  populateHistoriqueFilterSelect();
  document.getElementById('histo-search').addEventListener('input', applyHistoriqueFilter);
  document.getElementById('histo-filter-exercice').addEventListener('change', applyHistoriqueFilter);
}

function populateHistoriqueFilterSelect() {
  const select = document.getElementById('histo-filter-exercice');
  select.querySelectorAll('option:not([value=""])').forEach(o => o.remove());
  currentExercices.forEach(ex => {
    const o = document.createElement('option');
    o.value = ex.id; o.textContent = `${ex.icon} ${ex.nom}`;
    select.appendChild(o);
  });
}

function applyHistoriqueFilter() {
  const tbody    = document.getElementById('historique-tbody');
  const search   = document.getElementById('histo-search').value.trim().toLowerCase();
  const exercice = document.getElementById('histo-filter-exercice').value;
  let total = 0, visibles = 0;

  tbody.querySelectorAll('tr').forEach(tr => {
    if (tr.id === 'histo-no-match') { tr.remove(); return; }
    if (!tr.dataset.search) return; // ligne "chargement"/"aucun enregistrement"
    total++;
    const matchExercice = !exercice || tr.dataset.exercice === exercice;
    const matchSearch   = !search || tr.dataset.search.includes(search);
    const show = matchExercice && matchSearch;
    tr.style.display = show ? '' : 'none';
    if (show) visibles++;
  });

  if (total > 0 && visibles === 0) {
    const tr = document.createElement('tr');
    tr.id = 'histo-no-match';
    tr.innerHTML = '<td colspan="8" class="muted loading">Aucun résultat pour ce filtre.</td>';
    tbody.appendChild(tr);
  }
}

// ================================================================
//  SUPPRESSION D'UN ENREGISTREMENT HISTORIQUE (réel, irréversible)
// ================================================================
function initHistoriqueDelete() {
  document.getElementById('historique-tbody').addEventListener('click', e => {
    const btn = e.target.closest('.btn-delete-histo');
    if (!btn) return;
    deleteHistoriqueRecord(btn);
  });
}

async function deleteHistoriqueRecord(btn) {
  const recordId = btn.dataset.recordId;
  const label    = btn.dataset.recordLabel;

  const confirmed = confirm(
    `Confirmer la suppression définitive de :\n\n${label}\n\nCette action est irréversible.`
  );
  if (!confirmed) return;

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '…';

  try {
    const res = await apiFetch(`${API_EX}?id=${recordId}`, { method: 'DELETE' });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || `HTTP ${res.status}`); }

    allExRecords = allExRecords.filter(r => r.id !== recordId);
    showToast(`🗑️ Supprimé : ${label}`, 'ok');

    buildLastDates();
    renderDashboard();
  } catch (e) {
    showToast(`✗ Suppression impossible : ${e.message}`, 'err');
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ================================================================
//  HELPERS
// ================================================================
// isoWeek, computePlannedWeeks et analyzeExercise vivent désormais dans
// lib/planning-logic.js (chargé avant ce script), pour être testables
// indépendamment du navigateur — voir tests/planning-logic.spec.js.

// À utiliser systématiquement pour tout champ venant de la base (texte libre,
// potentiellement saisi par n'importe qui via le proxy) inséré dans du
// HTML (innerHTML ou attribut) — jamais interpoler ces champs bruts.
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  setTimeout(() => { t.className = 'toast'; }, 4500);
}
