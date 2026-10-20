import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const botPattern = /github-actions|dependabot|renovate|\[bot\]/i;

function runGit(args, input) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function findProductSpecCommit() {
  const output = runGit(['log', '--format=%H%x00%s', 'HEAD']);
  const matches = output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split('\0');
      return { sha, subject };
    })
    .filter(({ subject }) => subject === 'Add product spec');

  if (matches.length === 0) {
    throw new Error('could not find an ancestor commit with the exact subject "Add product spec"');
  }

  if (matches.length > 1) {
    const commits = matches.map(({ sha }) => sha).join(', ');
    throw new Error(
      `found multiple "Add product spec" commits (${commits}); the anchor must be unique`,
    );
  }

  return matches[0].sha;
}

function commitDetails(sha) {
  const metadata = runGit(['show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce%x00%s', sha]).trimEnd();
  const [authorName, authorEmail, committerName, committerEmail, subject] = metadata.split('\0');
  const message = runGit(['show', '-s', '--format=%B', sha]);
  return {
    authorName,
    authorEmail,
    committerName,
    committerEmail,
    subject,
    message,
  };
}

function parsedTrailers(message) {
  const trailers = new Map();

  // Keep accepting trailer lines separated by a blank paragraph. This matches
  // the starter's documented commit examples and keeps the check useful for
  // commits made by clients that insert a paragraph between trailers.
  for (const line of message.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    const values = trailers.get(key) ?? [];
    values.push(value.trim());
    trailers.set(key, values);
  }

  return trailers;
}

function isBot(details) {
  return [
    details.authorName,
    details.authorEmail,
    details.committerName,
    details.committerEmail,
  ].some((value) => botPattern.test(value ?? ''));
}

function checkCommit(sha) {
  const details = commitDetails(sha);
  const trailers = parsedTrailers(details.message);
  const failures = [];
  const sessions = trailers.get('Session') ?? [];
  const agents = trailers.get('Agent') ?? [];

  if (!sessions.some((value) => /^\d+$/.test(value))) {
    failures.push(
      sessions.length === 0
        ? 'missing Session: <number> trailer'
        : 'invalid Session trailer (expected Session: <number>)',
    );
  }

  if (!agents.some((value) => value.length > 0)) {
    failures.push(
      agents.length === 0
        ? 'missing Agent: <name> trailer'
        : 'invalid Agent trailer (expected Agent: <name>)',
    );
  }

  return { details, failures };
}

function main() {
  let anchor;
  try {
    anchor = findProductSpecCommit();
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    console.error('Summary: 0 commits checked.');
    process.exitCode = 2;
    return;
  }

  const commitLines = runGit(['rev-list', '--reverse', '--parents', `${anchor}..HEAD`])
    .split('\n')
    .filter(Boolean);
  let checked = 0;
  let skippedMerges = 0;
  let skippedBots = 0;
  const failures = [];

  for (const line of commitLines) {
    const parts = line.trim().split(/\s+/);
    const sha = parts[0];
    const parentCount = parts.length - 1;

    if (parentCount > 1) {
      skippedMerges += 1;
      continue;
    }

    const details = commitDetails(sha);
    if (isBot(details)) {
      skippedBots += 1;
      continue;
    }

    checked += 1;
    const result = checkCommit(sha);
    if (result.failures.length > 0) {
      failures.push({ sha, subject: result.details.subject, reasons: result.failures });
    }
  }

  for (const failure of failures) {
    console.error(
      `FAIL ${failure.sha.slice(0, 12)} ${JSON.stringify(failure.subject)}: ${failure.reasons.join('; ')}`,
    );
  }

  console.log(
    `Summary: checked ${checked} commit(s); skipped ${skippedMerges} merge commit(s) and ${skippedBots} bot commit(s).`,
  );

  if (failures.length > 0) {
    console.error(`Found ${failures.length} commit(s) without the required trailers.`);
    process.exitCode = 1;
  } else {
    console.log('All checked commits have Session: <number> and Agent: <name> trailers.');
  }
}

try {
  main();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  console.error('Summary: unable to complete the commit trailer check.');
  process.exitCode = 2;
}
