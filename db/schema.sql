-- ============================================================
--  Schéma Postgres — table exercices_realises
--
--  Remplace la table Airtable "Exercices_Realises" (voir README.md,
--  section Multi-navires). Structure déduite de vraies données de
--  production plutôt que devinée.
--
--  Comme pour Airtable (voir CLAUDE.md, section "Architecture — 3
--  environnements séparés"), prévoir une base Postgres distincte par
--  environnement (Development / Preview / Production) plutôt qu'une
--  colonne "environnement" partagée — même principe d'isolation :
--  impossible de casser la Production en travaillant en local.
-- ============================================================

CREATE TABLE IF NOT EXISTS exercices_realises (
  id                      SERIAL PRIMARY KEY,
  navire                  TEXT NOT NULL,
  type_exercice           TEXT NOT NULL,
  nom_exercice            TEXT NOT NULL,
  date_realisation        DATE NOT NULL,
  semaine                 INTEGER NOT NULL,
  annee                   INTEGER NOT NULL,
  saisi_par               TEXT NOT NULL DEFAULT '',
  observations            TEXT NOT NULL DEFAULT '',
  source                  TEXT NOT NULL DEFAULT '',
  -- NULL pour les saisies manuelles (pas d'inspection SafetyCulture liée) —
  -- voir README.md section "Intégration SafetyCulture".
  lien_inspection         TEXT,
  safetyculture_audit_id  TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Traçabilité + suppression logique (voir README.md, section "Quelques
  -- défis techniques" — exercice d'intrusion simulée) : email du compte
  -- Google authentifié à l'origine de l'écriture ou de la suppression (NULL
  -- si jeton de contournement de test, jamais utilisable en Production). Un
  -- enregistrement supprimé reste en base avec deleted_at renseigné plutôt
  -- que d'être détruit, pour rester récupérable immédiatement
  -- (scripts/restaurer-suppression.js) sans attendre la sauvegarde quotidienne.
  created_by              TEXT,
  deleted_at              TIMESTAMPTZ,
  deleted_by              TEXT
);

-- Ajoute les colonnes ci-dessus si la table existait déjà avant cette
-- migration — ALTER TABLE ... ADD COLUMN IF NOT EXISTS est idempotent.
ALTER TABLE exercices_realises ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE exercices_realises ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE exercices_realises ADD COLUMN IF NOT EXISTS deleted_by TEXT;

-- Anti-doublon du webhook SafetyCulture : reproduit exactement la
-- vérification faite aujourd'hui côté Airtable avant de créer un
-- enregistrement (voir CLAUDE.md, "Anti-doublon"). Un index UNIQUE
-- partiel (au lieu d'un UNIQUE simple) car plusieurs enregistrements
-- avec safetyculture_audit_id NULL doivent rester possibles (saisies
-- manuelles) — un UNIQUE classique aurait aussi fonctionné (Postgres
-- ne compare jamais deux NULL comme égaux), le partiel documente
-- l'intention plus explicitement.
CREATE UNIQUE INDEX IF NOT EXISTS exercices_realises_safetyculture_uniq
  ON exercices_realises (safetyculture_audit_id, type_exercice)
  WHERE safetyculture_audit_id IS NOT NULL;

-- Filtrage/tri courants du portail (Planning, Historique) : par navire,
-- par plage de dates, et la combinaison des deux (voir portail.js,
-- renderHistorique/loadAll).
CREATE INDEX IF NOT EXISTS exercices_realises_navire_idx ON exercices_realises (navire);
CREATE INDEX IF NOT EXISTS exercices_realises_date_idx ON exercices_realises (date_realisation);

-- ============================================================
--  Limitation de débit — api/db.js (POST/DELETE)
--
--  Voir README.md, section "Quelques défis techniques" (exercice
--  d'intrusion simulée) : rien n'empêchait un compte compromis d'enchaîner
--  des écritures/suppressions en rafale. Une ligne par écriture/suppression,
--  par identité (email du compte, ou 'e2e-test-bypass' pour le jeton de
--  test hors Production) ; api/db.js compte les lignes récentes avant
--  d'autoriser une nouvelle écriture, et purge les lignes anciennes à
--  chaque appel (la table reste petite : usage réel très occasionnel).
-- ============================================================
CREATE TABLE IF NOT EXISTS api_write_log (
  id          BIGSERIAL PRIMARY KEY,
  identity    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_write_log_identity_idx ON api_write_log (identity, created_at);
CREATE INDEX IF NOT EXISTS api_write_log_created_at_idx ON api_write_log (created_at);
