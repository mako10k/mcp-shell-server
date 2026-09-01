import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runSealgraph(args, encoding = 'utf8') {
  const result = spawnSync('sealgraph', args, {
    cwd: repositoryRoot,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : result.stderr;
    throw new Error(`sealgraph ${args.join(' ')} failed (${result.status}): ${stderr.trim()}`);
  }

  return result.stdout;
}

function parseJson(command, output) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${command} returned invalid JSON: ${error.message}`);
  }
}

const version = runSealgraph(['--version']).trim();
if (version !== 'sealgraph 0.1.0-beta.6') {
  throw new Error(`Expected sealgraph 0.1.0-beta.6, found ${version}`);
}

const fsck = parseJson(
  'sealgraph fsck',
  runSealgraph(['fsck', '--format', 'json']),
);
if (fsck.result !== 'ok') {
  throw new Error(`Sealgraph fsck result was ${JSON.stringify(fsck.result)}`);
}

const stale = parseJson(
  'sealgraph stale --scan',
  runSealgraph(['stale', '--scan', '--format', 'json']),
);
if (!Array.isArray(stale.statuses) || stale.statuses.length !== 0) {
  throw new Error(`Sealgraph contains stale REF heads: ${JSON.stringify(stale.statuses)}`);
}

const status = parseJson(
  'sealgraph status',
  runSealgraph(['status', '--format', 'json']),
);
if (!Array.isArray(status.statuses) || status.statuses.length !== fsck.refs) {
  throw new Error(
    `Sealgraph status reported ${status.statuses?.length ?? 'invalid'} REF heads; fsck reported ${fsck.refs}`,
  );
}

for (const refStatus of status.statuses) {
  if (refStatus.candidate_to_head !== 'NO_CANDIDATE' || refStatus.draft !== false) {
    throw new Error(`Sealgraph REF ${refStatus.ref} has mutable candidate or draft state`);
  }

  const repositoryPath = path.resolve(repositoryRoot, refStatus.ref);
  const relativePath = path.relative(repositoryRoot, repositoryPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Sealgraph REF escapes the repository: ${refStatus.ref}`);
  }
  if (!fs.statSync(repositoryPath).isFile()) {
    throw new Error(`Sealgraph REF does not resolve to a repository file: ${refStatus.ref}`);
  }

  const sealedContent = runSealgraph(['show', refStatus.ref, '--raw-content'], null);
  const repositoryContent = fs.readFileSync(repositoryPath);
  if (!sealedContent.equals(repositoryContent)) {
    throw new Error(`Sealgraph content differs from repository file: ${refStatus.ref}`);
  }
}

console.log(`Sealgraph validation passed for ${status.statuses.length} REF heads.`);
