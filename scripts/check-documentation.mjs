import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function reportFailure(message) {
  failures.push(message);
}

function assertEqual(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    reportFailure(
      `${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function extractMatches(text, expression) {
  return [...text.matchAll(expression)].map((match) => match[1]);
}

const packageJson = readJson('package.json');
const extensionPackage = readJson('extensions/vscode-mcp-shell/package.json');
const serverSource = read('src/server.ts');
const extensionSource = read('extensions/vscode-mcp-shell/src/extension.ts');
const readme = read('README.md');
const specification = read('docs/specification.md');

const uncommentedServerSource = serverSource.replace(/\/\*[\s\S]*?\*\//g, '');
const toolListStart = uncommentedServerSource.indexOf('tools: [');
const toolListEnd = uncommentedServerSource.indexOf('].filter(', toolListStart);
if (toolListStart < 0 || toolListEnd < 0) {
  reportFailure('Could not locate the public tool list in src/server.ts');
}
const serverTools =
  toolListStart >= 0 && toolListEnd >= 0
    ? extractMatches(
        uncommentedServerSource.slice(toolListStart, toolListEnd),
        /name:\s*'([a-z][a-z0-9_]*)'/g,
      )
    : [];

const extensionTools = extensionPackage.contributes.languageModelTools.map((tool) => tool.name);
const extensionActivationTools = extensionPackage.activationEvents
  .filter((event) => event.startsWith('onLanguageModelTool:'))
  .map((event) => event.slice('onLanguageModelTool:'.length));
const extensionToolNamesBlock = extensionSource.match(
  /const TOOL_NAMES = \[([\s\S]*?)\] as const;/,
);
const extensionSourceTools = extensionToolNamesBlock
  ? extractMatches(extensionToolNamesBlock[1], /'([a-z][a-z0-9_]*)'/g)
  : [];

const readmeApiStart = readme.indexOf('## API Reference');
const readmeApiEnd = readme.indexOf('## Architecture', readmeApiStart);
const readmeTools =
  readmeApiStart >= 0 && readmeApiEnd >= 0
    ? extractMatches(
        readme.slice(readmeApiStart, readmeApiEnd),
        /^#### `([a-z][a-z0-9_]*)`/gm,
      )
    : [];
const specificationPublicEnd = specification.indexOf('旧名の');
const specificationTools = extractMatches(
  specification.slice(0, specificationPublicEnd),
  /^\| [^|]+ \| `([a-z][a-z0-9_]*)` \|$/gm,
);

assertEqual('VS Code language-model tool names differ from src/server.ts', extensionTools, serverTools);
assertEqual(
  'VS Code activation events differ from src/server.ts',
  extensionActivationTools,
  serverTools,
);
assertEqual('VS Code TOOL_NAMES differ from src/server.ts', extensionSourceTools, serverTools);
assertEqual('README API headings differ from src/server.ts', readmeTools, serverTools);
assertEqual('Specification public-tool table differs from src/server.ts', specificationTools, serverTools);

if (serverTools.length !== 13) {
  reportFailure(`Expected 13 default public tools, found ${serverTools.length}`);
}
if (!readme.includes(`**${serverTools.length} MCP Tools**`)) {
  reportFailure('README tool-count claim does not match the registered default tool count');
}

const recommendedName = 'MCP Shell Server';
const recommendedDescription =
  'Model Context Protocol server for shell command execution, terminal sessions, and retained output management';
if (!readme.startsWith(`# ${recommendedName}\n`)) {
  reportFailure(`README title must be ${recommendedName}`);
}
if (extensionPackage.displayName !== recommendedName) {
  reportFailure(`VS Code displayName must be ${recommendedName}`);
}
if (packageJson.description !== recommendedDescription) {
  reportFailure('Root package description differs from the recommended factual description');
}

if (!readme.includes(`current package version is ${packageJson.version}`)) {
  reportFailure('README current-version statement differs from package.json');
}
if (!specification.includes(`version ${packageJson.version}`)) {
  reportFailure('Specification version differs from package.json');
}
const extensionServerVersion = extensionSource.match(
  /const SERVER_VERSION = '([^']+)';/,
)?.[1];
if (!extensionServerVersion) {
  reportFailure('Could not locate the VS Code bundled MCP server version');
} else if (
  extensionPackage.dependencies['@mako10k/mcp-shell-server'] !== `^${extensionServerVersion}`
) {
  reportFailure('VS Code bundled MCP server version differs from its dependency declaration');
}

const publicDocuments = [
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'GITHUB_SETUP.md',
  'docs/README.md',
  'docs/specification.md',
  'docs/control-codes.md',
  'docs/program-guard.md',
  'docs/document-provenance.md',
  'docs/setup/claude-desktop.md',
  'docs/setup/vscode.md',
];

for (const relativePath of publicDocuments) {
  const contents = read(relativePath);
  for (const match of contents.matchAll(/```json\s*\n([\s\S]*?)```/g)) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      reportFailure(`${relativePath} contains an invalid JSON code block: ${error.message}`);
    }
  }

  for (const match of contents.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim();
    const target = rawTarget.startsWith('<')
      ? rawTarget.slice(1, rawTarget.indexOf('>'))
      : rawTarget.split(/\s+/)[0];
    if (/^(?:https?:|mailto:|#)/.test(target)) {
      continue;
    }
    const pathWithoutFragment = decodeURIComponent(target.split('#')[0]);
    if (!pathWithoutFragment) {
      continue;
    }
    const resolvedTarget = path.resolve(repositoryRoot, path.dirname(relativePath), pathWithoutFragment);
    if (!fs.existsSync(resolvedTarget)) {
      reportFailure(`${relativePath} links to missing local target ${target}`);
    }
  }
}

const publicSurfaceText = [
  packageJson.description,
  extensionPackage.displayName,
  extensionPackage.description,
  ...publicDocuments.map(read),
].join('\n');
const unsupportedClaims = [
  /Safe Shell Runner/i,
  /Secure Shell Operations/i,
  /execute shell commands securely/i,
  /all operations are logged/i,
  /production[- ]ready/i,
];
for (const claim of unsupportedClaims) {
  if (claim.test(publicSurfaceText)) {
    reportFailure(`Public surface contains unsupported blanket claim ${claim}`);
  }
}

const configurationExamples = [
  'examples/claude-code-config.json',
  'examples/claude-desktop-config.json',
  'examples/cursor-mcp.json',
  'examples/vscode-mcp.json',
];
for (const relativePath of configurationExamples) {
  const contents = read(relativePath);
  const config = JSON.parse(contents);
  if (!contents.includes('MCP_SHELL_SECURITY_MODE')) {
    reportFailure(`${relativePath} does not state its execution mode explicitly`);
  }
  if (contents.includes('"/tmp"')) {
    reportFailure(`${relativePath} approves the shared /tmp directory`);
  }
  if (!config || typeof config !== 'object') {
    reportFailure(`${relativePath} must contain a JSON object`);
  }
}

if (failures.length > 0) {
  console.error('Documentation consistency check failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Documentation consistency check passed for ${serverTools.length} public tools.`);
}
