import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const extensionRoot = new URL('../', import.meta.url);
const serverRoot = new URL(
  'node_modules/@mako10k/mcp-shell-server/',
  extensionRoot,
);
const bundleRoot = new URL('dist/mcp-shell-server/', extensionRoot);
const bundleDirectory = new URL('dist/', bundleRoot);
const bundleEntry = new URL('index.mjs', bundleDirectory);
const sourcePackage = new URL('package.json', serverRoot);
const bundledPackage = new URL('package.json', bundleRoot);

await Promise.all([
  rm(new URL('dist/mcp-shell-server.js', extensionRoot), { force: true }),
  rm(new URL('dist/mcp-shell-server.js.map', extensionRoot), { force: true }),
  rm(bundleRoot, { recursive: true, force: true }),
]);
await mkdir(bundleDirectory, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('dist/index.js', serverRoot))],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  sourcemap: true,
  outfile: fileURLToPath(bundleEntry),
  external: ['node-pty'],
});
await copyFile(sourcePackage, bundledPackage);

const serverPackage = JSON.parse(await readFile(sourcePackage, 'utf8'));
const smoke = spawnSync(process.execPath, [fileURLToPath(bundleEntry), '--version'], {
  encoding: 'utf8',
});
if (smoke.error) {
  throw smoke.error;
}
if (smoke.status !== 0 || smoke.stdout.trim() !== serverPackage.version) {
  throw new Error(
    `Bundled server version check failed: status=${smoke.status}, ` +
      `stdout=${JSON.stringify(smoke.stdout.trim())}, ` +
      `stderr=${JSON.stringify(smoke.stderr.trim())}, ` +
      `expected=${JSON.stringify(serverPackage.version)}`,
  );
}

console.log(`Bundled MCP Shell Server ${serverPackage.version}`);
