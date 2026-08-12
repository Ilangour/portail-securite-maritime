# Portail Sécurité Maritime

Outil de suivi des exercices de sécurité (incendie, abandon, homme à la mer, pollution...) pour une flotte de navires — construit pour répondre à un besoin réel de conformité réglementaire, avec intégration à un outil d'inspection terrain (SafetyCulture).

> Ce dépôt est une **version portfolio** d'un outil réellement en production pour une compagnie maritime. Le code est identique dans sa structure et sa logique, mais toutes les données (navires, entreprise, identifiants techniques) sont fictives — voir [Anonymisation](#anonymisation-de-cette-version).

## Le problème

Une flotte de navires doit réaliser régulièrement des exercices de sécurité réglementaires (incendie, abandon, homme à la mer, pollution, etc.), à une fréquence différente selon le type d'exercice et le navire. Le suivi se faisait jusqu'ici sur tableur, sans vue d'ensemble en temps réel, sans historique fiable, et sans lien avec les vraies inspections terrain réalisées via l'application SafetyCulture par les équipages.

## Ce que fait l'outil

- **Planning** : cartes de statut par type d'exercice (à jour / bientôt dû / en retard), prochain exercice à réaliser, grille hebdomadaire annuelle, saisie rapide
- **Indicateurs** : taux de conformité, % d'exercices manquants, ratio réalisé/planifié, tableau réglementaire détaillé, histogramme
- **Historique** : tous les exercices réalisés, avec lien direct vers l'inspection SafetyCulture d'origine quand disponible
- **Intégration SafetyCulture** : un webhook crée automatiquement l'enregistrement correspondant dès qu'une inspection terrain est marquée complète — plus de double saisie
- **Mode hors-ligne** : une saisie qui échoue faute de réseau est conservée en brouillon local, avec renvoi manuel au retour de connexion

## Stack

HTML/CSS/JS vanilla, sans framework ni étape de build — un choix délibéré pour un outil de cette taille, pas une contrainte technique. Déployé sur Vercel (Functions serverless), base de données Postgres (Neon).

- `index.html` / `portail.js` / `style.css` — le portail (3 pages : Planning / Indicateurs / Historique)
- `config.js` — catalogue des exercices + configuration par navire (fréquence réglementaire, planning annuel)
- `lib/` — logique de calcul pure (planning, indicateurs, correspondance SafetyCulture), testée indépendamment du navigateur
- `api/` — fonctions serveur : proxy base de données authentifié, webhook SafetyCulture, sauvegarde automatique, rattrapage des inspections manquées
- `tests/` — suite Playwright (tests unitaires purs + tests navigateur : navigation, saisie, mode hors-ligne, non-régression XSS)

## Quelques défis techniques rencontrés (et corrigés)

Ce projet a une histoire — quelques exemples de problèmes réels rencontrés et de la façon dont ils ont été diagnostiqués et corrigés, plutôt qu'une simple liste de fonctionnalités :

- **Webhook manqué, silencieusement.** Un exercice réel, correctement saisi côté inspection terrain, n'apparaissait jamais dans l'outil — sans aucune erreur visible. Cause : le service d'inspection ne réessaie une livraison de webhook en échec que quelques fois sur une courte fenêtre ; au-delà, l'événement est perdu sans autre signal. Solution : un filet de sécurité (Cron Job quotidien) qui repasse sur les inspections récentes et rattrape ce qui manque, avec alerte de monitoring si un rattrapage a effectivement lieu — pour comprendre *pourquoi* le webhook a raté, pas seulement corriger la donnée.
- **Base de données fantôme.** Lors d'un audit de cohérence des données, les résultats ne correspondaient pas à ce que montrait réellement l'outil. Cause : deux variables d'environnement pointaient vers deux bases Postgres différentes — le code utilisait la bonne, mais un projet de base de données plus ancien, jamais réellement débranché, semblait tout aussi légitime au premier regard. Diagnostiqué en déployant temporairement un endpoint de diagnostic qui révèle, sans exposer aucun secret, l'hôte réel utilisé par le code déployé.
- **Bug CSS improbable.** Un indicateur de rafraîchissement, censé être un petit point de 8 pixels, s'affichait occasionnellement comme un gros rond — pendant moins d'une seconde, ce qui le rendait difficile à décrire précisément. Cause : une collision de nom de classe CSS avec un style générique de "chargement" utilisé ailleurs sur la page (`padding: 36px`), qui s'appliquait par erreur à ce petit indicateur.
- **Un test de sécurité qui ne testait plus rien.** Après une migration de base de données, un test de non-régression XSS continuait techniquement de s'exécuter et d'échouer — mais pour la mauvaise raison : il écrivait sa donnée de test vers un ancien point d'entrée API désactivé, donc la donnée n'était jamais réellement insérée, et le test ne validait plus rien depuis plusieurs jours sans que l'échec ne soit remarqué comme anormal.
- **Exercice d'intrusion simulée, à la demande du client.** Plutôt que d'attendre un incident réel, une simulation active de vol et de corruption de données a été menée contre l'environnement de recette (jamais la production) : tentatives d'injection SQL, XSS stocké, accès non authentifié, suppression forcée d'enregistrements. L'injection SQL et le XSS n'ont laissé aucune prise (requêtes paramétrées, échappement systématique déjà en place). Deux points ont en revanche abouti et ont été corrigés le jour même : une suppression d'enregistrement ne vérifiait la présence d'une authentification mais pas la propriété de la donnée (n'importe quel compte pouvait supprimer n'importe quel enregistrement en devinant son identifiant) — remplacée par une suppression logique, traçable et réversible ; et les messages d'erreur renvoyaient parfois des détails internes de la base — remplacés par des messages génériques, le détail restant uniquement dans l'outil de supervision interne. Une limitation de débit par compte a été ajoutée dans la foulée.

## Sécurité

- Authentification Google OAuth, restreinte au domaine de l'entreprise cliente, vérifiée côté serveur (pas seulement côté client)
- Échappement systématique de tout champ texte libre affiché (protection XSS), avec test de non-régression dédié
- Un jeton d'API dédié aux tests automatisés, explicitement bloqué en production quel que soit le jeton fourni
- Suppression logique des enregistrements (traçable et réversible) plutôt qu'une suppression définitive, avec limitation de débit par compte sur les écritures
- En-têtes de durcissement HTTP (CSP, X-Content-Type-Options, X-Frame-Options) et exercice d'intrusion simulée périodique pour vérifier ces protections en conditions réelles
- Toute variable sensible (base de données, jetons d'API) gérée via variables d'environnement, jamais commitée

## Lancer le projet

```bash
npm install
cp .env.example .env.local   # à compléter avec vos propres identifiants (voir ci-dessous)
vercel dev
```

Variables d'environnement nécessaires (voir `.env.example`) :
- `DATABASE_URL` — connexion Postgres (ex: [Neon](https://neon.tech), plan gratuit suffisant pour tester)
- `GOOGLE_CLIENT_ID` — identifiant OAuth Google ([console Google Cloud](https://console.cloud.google.com))
- `SAFETYCULTURE_API_TOKEN` / `SAFETYCULTURE_WEBHOOK_SECRET` / `SAFETYCULTURE_TEMPLATE_ID` — optionnel, seulement pour tester l'intégration SafetyCulture
- `GITHUB_BACKUP_TOKEN` / `GITHUB_REPO` — optionnel, seulement pour tester la sauvegarde automatique

Pour peupler la base avec des données de démonstration (fictives) :

```bash
node scripts/apply-schema.js --database-url "$DATABASE_URL"
node scripts/seed-postgres.js --backup db/seed-sample.json --database-url "$DATABASE_URL" --yes
```

## Tests

```bash
npm run lint   # ESLint
npm test       # Playwright — tests unitaires purs + tests navigateur
```

## Anonymisation de cette version

Ce dépôt est dérivé d'un outil réel en production. Pour cette version publique :
- Les noms de navires et de l'entreprise sont fictifs
- Les données réelles (historique des exercices, noms d'officiers) ont été retirées, remplacées par un jeu de données fictif (`db/seed-sample.json`)
- Les identifiants techniques réels (clés API, identifiants OAuth, domaine autorisé) ont été remplacés par des valeurs d'exemple à configurer soi-même

La logique métier, l'architecture et le code sont, eux, identiques à la version en production.

## Licence

MIT — voir `LICENSE`.
