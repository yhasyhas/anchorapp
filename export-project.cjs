/**
 * export-project.cjs
 *
 * Exporte l'ensemble du projet dans un unique fichier Markdown
 * (`project-export.md`) afin de donner à un LLM le contexte complet :
 *   1. Un arbre de la structure du projet
 *   2. Le contenu de chaque fichier texte, avec chemins relatifs
 *
 * Sont exclus : node_modules, .git, dist, fichiers .env, lockfiles,
 * binaires (images, polices...), logs et autres artefacts de build.
 *
 * Usage :  node export-project.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const OUTPUT_FILE = 'project-export.md';

// --- Exclusions ------------------------------------------------------------

// Dossiers toujours ignorés (où qu'ils soient dans l'arborescence)
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-ssr', '.vscode', '.idea',
  'coverage', '.next', 'build', 'out', '.cache', '.tmp', '.vite',
  '.vite-temp', 'logs',
]);

// Fichiers toujours ignorés (par nom exact)
const IGNORED_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.DS_Store', 'Thumbs.db', OUTPUT_FILE,
  'export-project.cjs', // le script ne s'exporte pas lui-même
]);

// Motifs ignorés (correspondance sur le nom de fichier)
const IGNORED_PATTERNS = [
  /^\.env($|\.)/,   // .env, .env.local, .env.production...
  /\.log$/, /\.map$/, /\.local$/, /\.suo$/, /\.sw.$/,
];

// Extensions texte à inclure dans l'export
const TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.css', '.scss', '.less',
  '.html', '.json', '.md', '.txt', '.yml', '.yaml',
  '.sql', '.toml', '.xml', '.svg', '.example', '.sample',
]);

// Fichiers sans extension mais utiles au contexte
const EXTENSIONLESS = new Set(['LICENSE', 'Dockerfile', 'Makefile']);

// Taille max par fichier (évite d'embarquer des JSON générés énormes)
const MAX_FILE_SIZE = 200 * 1024; // 200 Ko

// --- Helpers ---------------------------------------------------------------

function shouldIgnoreDir(name) {
  return IGNORED_DIRS.has(name);
}

function shouldIgnoreFile(name) {
  if (IGNORED_FILES.has(name)) return true;
  if (name.startsWith('.') && !name.startsWith('.env.example')) {
    // ignore les dotfiles (.eslintrc, .gitignore...) sauf exceptions utiles
    return !['.gitignore', '.env.example', '.env.sample'].includes(name);
  }
  return IGNORED_PATTERNS.some((re) => re.test(name));
}

function isExportableFile(name) {
  if (EXTENSIONLESS.has(name)) return true;
  if (name.endsWith('.env.example') || name.endsWith('.env.sample')) return true;
  return TEXT_EXTS.has(path.extname(name).toLowerCase());
}

/** Parcours récursif : retourne la liste des fichiers exportables. */
function walk(dir, files = []) {
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  // Tri : dossiers d'abord, puis ordre alphabétique (arbre stable)
  items.sort((a, b) =>
    a.isDirectory() === b.isDirectory()
      ? a.name.localeCompare(b.name)
      : a.isDirectory() ? -1 : 1
  );

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (!shouldIgnoreDir(item.name)) walk(fullPath, files);
    } else if (item.isFile()) {
      if (shouldIgnoreFile(item.name) || !isExportableFile(item.name)) continue;
      files.push(fullPath);
    }
  }
  return files;
}

/** Construit un arbre texte (style `tree`) à partir des chemins relatifs. */
function buildTree(relPaths) {
  const root = {};
  for (const p of relPaths) {
    const parts = p.split('/');
    let node = root;
    for (const part of parts) {
      node = node[part] ??= {};
    }
  }
  const lines = [];
  (function render(node, prefix) {
    const entries = Object.keys(node).sort((a, b) => {
      const aDir = Object.keys(node[a]).length > 0;
      const bDir = Object.keys(node[b]).length > 0;
      return aDir === bDir ? a.localeCompare(b) : aDir ? -1 : 1;
    });
    entries.forEach((name, i) => {
      const last = i === entries.length - 1;
      lines.push(prefix + (last ? '└── ' : '├── ') + name);
      render(node[name], prefix + (last ? '    ' : '│   '));
    });
  })(root, '');
  return lines.join('\n');
}

/** Langage pour la coloration syntaxique du bloc de code. */
function langOf(filePath) {
  const name = path.basename(filePath);
  if (name === 'Dockerfile') return 'dockerfile';
  if (name.endsWith('.env.example') || name.endsWith('.env.sample')) return 'bash';
  const ext = path.extname(name).slice(1).toLowerCase();
  const map = { tsx: 'tsx', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx' };
  return map[ext] || ext || 'text';
}

// --- Génération ------------------------------------------------------------

function generate() {
  const absFiles = walk(ROOT_DIR);
  const files = [];
  let skippedLarge = 0;

  for (const absPath of absFiles) {
    const relPath = path.relative(ROOT_DIR, absPath).replace(/\\/g, '/');
    const stat = fs.statSync(absPath);
    if (stat.size > MAX_FILE_SIZE) {
      skippedLarge++;
      files.push({ path: relPath, content: null, size: stat.size });
      continue;
    }
    try {
      files.push({ path: relPath, content: fs.readFileSync(absPath, 'utf-8') });
    } catch {
      // fichier illisible (encodage...) : on l'ignore silencieusement
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const relPaths = files.map((f) => f.path);

  let output = '';
  output += '# Export du projet — Anchorapp\n\n';
  output += `**Généré le :** ${new Date().toISOString()}\n`;
  output += `**Fichiers inclus :** ${relPaths.length}\n\n`;
  output += '> Ce fichier donne à un LLM le contexte complet du projet :\n';
  output += '> sa structure arborescente puis le contenu de chaque fichier source.\n\n';
  output += '---\n\n';

  output += '## Structure du projet\n\n';
  output += '```text\n';
  output += '.\n' + buildTree(relPaths) + '\n';
  output += '```\n\n---\n\n';

  output += '## Contenu des fichiers\n\n';
  for (const file of files) {
    output += `### \`${file.path}\`\n\n`;
    if (file.content === null) {
      output += `*Fichier ignoré : trop volumineux (${Math.round(file.size / 1024)} Ko > ${MAX_FILE_SIZE / 1024} Ko).*\n\n`;
    } else {
      output += '```' + langOf(file.path) + '\n';
      output += file.content.replace(/\s+$/, '') + '\n';
      output += '```\n\n';
    }
    output += '---\n\n';
  }

  fs.writeFileSync(OUTPUT_FILE, output, 'utf-8');

  const sizeKb = Math.round(fs.statSync(OUTPUT_FILE).size / 1024);
  console.log(`✅ ${relPaths.length} fichiers exportés vers ${OUTPUT_FILE} (${sizeKb} Ko)`);
  if (skippedLarge > 0) {
    console.log(`⚠️  ${skippedLarge} fichier(s) > ${MAX_FILE_SIZE / 1024} Ko listés sans contenu.`);
  }
}

generate();
