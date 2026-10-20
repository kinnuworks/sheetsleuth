import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockfilePath = path.join(repoRoot, 'package-lock.json');
const darwinVariant = /(?:^|[-/])darwin-arm64(?:$|[-/])/;

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function packageNameFromPath(packagePath) {
  const marker = 'node_modules/';
  const markerIndex = packagePath.lastIndexOf(marker);
  if (markerIndex === -1) return null;

  const packagePathPart = packagePath.slice(markerIndex + marker.length);
  if (packagePathPart.startsWith('@')) {
    const [scope, name] = packagePathPart.split('/');
    return scope && name ? `${scope}/${name}` : null;
  }

  return packagePathPart.split('/')[0] || null;
}

function collectPackageNames(lockfile) {
  const names = new Set();
  const packages = lockfile.packages;

  if (packages && typeof packages === 'object') {
    for (const [packagePath, metadata] of Object.entries(packages)) {
      if (metadata && typeof metadata.name === 'string') {
        names.add(metadata.name);
      } else {
        const name = packageNameFromPath(packagePath);
        if (name) names.add(name);
      }
    }
  }

  function collectDependencies(dependencies) {
    if (!dependencies || typeof dependencies !== 'object') return;
    for (const [name, dependency] of Object.entries(dependencies)) {
      names.add(name);
      if (dependency && typeof dependency === 'object') {
        collectDependencies(dependency.dependencies);
      }
    }
  }

  collectDependencies(lockfile.dependencies);
  return names;
}

function expectedVariants(darwinName, platform) {
  const exact = darwinName.replace('darwin-arm64', platform);
  const variants = [exact];
  if (!exact.endsWith('-gnu')) variants.push(`${exact}-gnu`);
  return variants;
}

function main() {
  if (!existsSync(lockfilePath)) {
    console.error(
      'FAIL: package-lock.json was not found. Generate the workspace lockfile before running this check.',
    );
    process.exitCode = 2;
    return;
  }

  let lockfile;
  try {
    lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  } catch (error) {
    console.error(`FAIL: could not parse package-lock.json: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const names = collectPackageNames(lockfile);
  const darwinNames = [...names].filter((name) => darwinVariant.test(name)).sort(compareNames);
  const failures = [];

  for (const darwinName of darwinNames) {
    for (const [label, platform] of [
      ['linux x64', 'linux-x64'],
      ['linux arm64', 'linux-arm64'],
    ]) {
      const expected = expectedVariants(darwinName, platform);
      if (!expected.some((name) => names.has(name))) {
        failures.push(
          `Missing ${label} variant for ${darwinName}: expected ${expected.join(' or ')}.`,
        );
      }
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    console.error(
      `Summary: checked ${darwinNames.length} darwin-arm64 variant(s); found ${failures.length} missing Linux variant(s).`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `PASS: checked ${darwinNames.length} darwin-arm64 variant(s); every variant has matching Linux x64 and arm64 packages.`,
  );
}

main();
