import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const detectorsDirectory = path.join(repoRoot, 'docs', 'detectors');
const functionsDirectory = path.join(repoRoot, 'packages', 'core', 'src', 'eval', 'functions');
const detectorsOutput = path.join(repoRoot, 'docs', 'DETECTORS.md');
const functionsOutput = path.join(repoRoot, 'docs', 'SUPPORTED_FUNCTIONS.md');
const sourceExtensions = new Set(['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts', '.tsx']);

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedText(filePath) {
  return readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n').trim();
}

function detectorFiles() {
  if (!existsSync(detectorsDirectory)) return [];
  return readdirSync(detectorsDirectory)
    .filter((name) => /^D.*\.md$/.test(name))
    .sort(compareNames)
    .map((name) => path.join(detectorsDirectory, name))
    .filter((filePath) => statSync(filePath).isFile());
}

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];

  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    compareNames(left.name, right.name),
  );

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(entryPath));
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}

function exportedFunctionNames(source) {
  const functionLikeNames = new Set();
  const exportedNames = new Set();
  const name = '[A-Za-z_$][A-Za-z0-9_$]*';

  const functionDeclarations = new RegExp(
    `\\b(?:export\\s+)?(?:async\\s+)?function\\s+(${name})\\b`,
    'g',
  );
  for (const match of source.matchAll(functionDeclarations)) {
    functionLikeNames.add(match[1]);
    if (/\bexport\b/.test(match[0])) exportedNames.add(match[1]);
  }

  const functionVariables = new RegExp(
    `\\b(?:export\\s+)?(?:const|let|var)\\s+(${name})(?:\\s*:\\s*[^=;]+)?\\s*=\\s*(?:(?:async\\s*)?function\\b|(?:async\\s*)?(?:${name}|\\([^;]*\\))\\s*=>)`,
    'g',
  );
  for (const match of source.matchAll(functionVariables)) {
    functionLikeNames.add(match[1]);
    if (/\bexport\b/.test(match[0])) exportedNames.add(match[1]);
  }

  const exportLists = /\bexport\s*{([^}]+)}/g;
  for (const match of source.matchAll(exportLists)) {
    for (const item of match[1].split(',')) {
      const parts = item.trim().split(/\s+as\s+/);
      const localName = parts[0]?.trim();
      const exportedName = parts[1]?.trim() || localName;
      if (functionLikeNames.has(localName) && exportedName) {
        exportedNames.add(exportedName);
      }
    }
  }

  return exportedNames;
}

function renderDetectors() {
  const sections = detectorFiles().map(normalizedText).filter(Boolean);
  const body =
    sections.length > 0 ? sections.join('\n\n') : '_No detector documentation found yet._';
  return `# Detectors\n\n${body}\n`;
}

function renderFunctions() {
  const names = new Set();
  for (const filePath of sourceFiles(functionsDirectory)) {
    for (const name of exportedFunctionNames(readFileSync(filePath, 'utf8'))) {
      names.add(name);
    }
  }

  const sortedNames = [...names].sort(compareNames);
  const body =
    sortedNames.length > 0
      ? sortedNames.map((name) => `- \`${name}\``).join('\n')
      : '_No exported functions found yet._';
  return `# Supported Functions\n\n${body}\n`;
}

mkdirSync(path.dirname(detectorsOutput), { recursive: true });
mkdirSync(path.dirname(functionsOutput), { recursive: true });
writeFileSync(detectorsOutput, renderDetectors());
writeFileSync(functionsOutput, renderFunctions());

console.log(
  `Generated ${path.relative(repoRoot, detectorsOutput)} and ${path.relative(repoRoot, functionsOutput)}.`,
);
