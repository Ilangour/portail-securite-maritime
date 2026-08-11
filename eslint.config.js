const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'backups/**', 'test-results/**', 'docs/**'],
  },
  js.configs.recommended,

  // Fonctions serveur Vercel — ESM (import/export)
  {
    files: ['api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // Code partagé navigateur/Node (lib/*.js, config.js) — double export
  // CommonJS + variable globale, voir README.md section "Tests".
  {
    files: ['lib/**/*.js', 'config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.node },
    },
  },

  // Portail navigateur (chargé via <script> classique, pas de bundler)
  {
    files: ['portail.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Définis par config.js / lib/planning-logic.js, chargés avant
        // portail.js dans index.html — voir README.md section "Multi-navires".
        CONFIG: 'readonly',
        isoWeek: 'readonly',
        computePlannedWeeks: 'readonly',
        analyzeExercise: 'readonly',
        computeRegulatoryStatus: 'readonly',
        computeKPIs: 'readonly',
        computeChartSegments: 'readonly',
        // Globales CDN (Chart.js, Google Identity Services, Sentry)
        Chart: 'readonly',
        google: 'readonly',
        Sentry: 'readonly',
      },
    },
  },

  // Tests Playwright + config — CommonJS (code Node), mais contiennent aussi
  // des callbacks page.evaluate()/addInitScript() qui s'exécutent côté
  // navigateur, dans le contexte de portail.js (voir README.md section
  // "Tests") — d'où les globales navigateur + internals de portail.js.
  {
    files: ['tests/**/*.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.browser,
        getDrafts: 'readonly',
        saveDraft: 'readonly',
        allExRecords: 'readonly',
      },
    },
  },

  // Scripts CLI (Node, exécutés à la main — pas déployés sur Vercel)
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // Ce fichier lui-même — CommonJS (Node)
  {
    files: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  {
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
