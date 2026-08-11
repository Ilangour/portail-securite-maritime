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
  -- voir CLAUDE.md section "Intégration SafetyCulture". 14/264 enregistrements
  -- réels n'ont ni l'un ni l'autre.
  lien_inspection         TEXT,
  safetyculture_audit_id  TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
