/**
 * check-i18n-keys.cjs
 *
 * Contrôle simple de cohérence i18n, à lancer avant de livrer :
 *   1. Compare src/locales/en.json et sw.json — signale toute clé présente
 *      dans l'un et absente de l'autre.
 *   2. Scanne le code (src/**\/*.ts, *.tsx) à la recherche des appels t("...")
 *      et signale les clés STATIQUES (littéral direct) qui n'existent dans
 *      AUCUN des deux fichiers de locale. Les clés dynamiques construites via
 *      template literal (ex: t(`mood.${key}`)) ne peuvent pas être résolues
 *      statiquement et sont ignorées — à vérifier manuellement.
 *
 * Usage : node check-i18n-keys.cjs
 * Sort avec un code non-nul si une incohérence est trouvée (utilisable en CI).
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const LOCALES_DIR = path.join(ROOT_DIR, 'src', 'locales');
const SRC_DIR = path.join(ROOT_DIR, 'src');

// --- Aplatit un objet JSON imbriqué en clés à points ("home.greeting") -----

function flatten(obj, prefix = '') {
  const out = new Set();
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const k of flatten(value, fullKey)) out.add(k);
    } else {
      out.add(fullKey);
    }
  }
  return out;
}

function loadLocale(name) {
  const filePath = path.join(LOCALES_DIR, name);
  const raw = fs.readFileSync(filePath, 'utf8');
  return flatten(JSON.parse(raw));
}

// --- Étape 1 : parité entre en.json et sw.json -----------------------------

const en = loadLocale('en.json');
const sw = loadLocale('sw.json');

const onlyInEn = [...en].filter((k) => !sw.has(k)).sort();
const onlyInSw = [...sw].filter((k) => !en.has(k)).sort();

let hasError = false;

if (onlyInEn.length > 0) {
  hasError = true;
  console.error(`\n❌ ${onlyInEn.length} clé(s) présente(s) dans en.json mais absente(s) de sw.json :`);
  onlyInEn.forEach((k) => console.error(`   - ${k}`));
}

if (onlyInSw.length > 0) {
  hasError = true;
  console.error(`\n❌ ${onlyInSw.length} clé(s) présente(s) dans sw.json mais absente(s) de en.json :`);
  onlyInSw.forEach((k) => console.error(`   - ${k}`));
}

if (!hasError) {
  console.log(`✓ en.json et sw.json ont exactement le même jeu de clés (${en.size} clés).`);
}

// --- Étape 2 : clés statiques utilisées dans le code mais absentes ---------

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-ssr']);
const CALL_PATTERN = /\bt\(\s*(['"])([a-zA-Z0-9_.]+)\1/g;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const usedKeys = new Set();
for (const file of walk(SRC_DIR)) {
  const content = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = CALL_PATTERN.exec(content))) {
    usedKeys.add(match[2]);
  }
}

const allLocaleKeys = new Set([...en, ...sw]);
const missingKeys = [...usedKeys].filter((k) => !allLocaleKeys.has(k)).sort();

if (missingKeys.length > 0) {
  hasError = true;
  console.error(`\n❌ ${missingKeys.length} clé(s) utilisée(s) dans le code mais absente(s) des deux locales :`);
  missingKeys.forEach((k) => console.error(`   - ${k}`));
} else {
  console.log(`✓ Toutes les clés statiques utilisées dans le code (${usedKeys.size}) existent dans les locales.`);
  console.log('  (Les clés dynamiques via template literal, ex: t(`mood.${key}`), ne sont pas vérifiées ici.)');
}

if (hasError) {
  console.error('\ni18n check failed.\n');
  process.exit(1);
}

console.log('\ni18n check passed.\n');
