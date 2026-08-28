import { randomUUID } from 'crypto';
import {
  existsSync,
  lstatSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { SecurityBoundaryError } from '../utils/errors.js';
import { canonicalizeExistingPath, isPathWithin } from '../utils/helpers.js';

const SANDBOX_TMP_BYTES = 64 * 1024 * 1024;
const FIXED_READY_WRAPPER =
  'printf \'%s\\n\' "$1" >&3; exec 3>&-; IFS= read -r start_token <&4 || exit 125; exec 4<&-; test "$start_token" = "$1" || exit 125; exec /usr/bin/bash --noprofile --norc -c "$2"';

export interface SandboxLaunchSpec {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  readinessToken: string;
  providerVersion: string;
}

export interface BwrapLauncherOptions {
  providerPath?: string;
}

export class BwrapLauncher {
  private readonly approvedRoots: string[];
  private readonly requestedProviderPath: string | undefined;
  private readyProviderPath?: string;
  private readyProviderVersion?: string;

  constructor(approvedRoots: string[], options: BwrapLauncherOptions = {}) {
    this.approvedRoots = approvedRoots
      .map((root) => canonicalizeExistingPath(root))
      .sort((left, right) => right.length - left.length);
    this.requestedProviderPath = options.providerPath || process.env['MCP_SHELL_BWRAP_PATH'];
  }

  buildLaunchSpec(command: string, workingDirectory: string): SandboxLaunchSpec {
    const providerPath = this.ensureProviderReady();
    const providerVersion = this.readyProviderVersion;
    if (!providerVersion) {
      throw new SecurityBoundaryError(
        'SANDBOX_SETUP_FAILED',
        'The Bubblewrap provider version was not recorded after capability probing.'
      );
    }
    const canonicalCwd = canonicalizeExistingPath(workingDirectory);
    const workspaceRoot = this.selectWorkspaceRoot(canonicalCwd);
    const relativeCwd = path.relative(workspaceRoot, canonicalCwd);
    const sandboxCwd = relativeCwd
      ? path.posix.join('/workspace', relativeCwd.split(path.sep).join('/'))
      : '/workspace';
    const readinessToken = `mcp-shell-ready-${randomUUID()}`;

    return {
      executable: providerPath,
      args: [
        ...this.buildBaseProfileArgs(),
        '--dir',
        '/workspace',
        '--ro-bind',
        workspaceRoot,
        '/workspace',
        '--chdir',
        sandboxCwd,
        '--',
        '/usr/bin/bash',
        '--noprofile',
        '--norc',
        '-c',
        FIXED_READY_WRAPPER,
        'sandbox-ready-wrapper',
        readinessToken,
        command,
      ],
      cwd: '/',
      env: {},
      readinessToken,
      providerVersion,
    };
  }

  private ensureProviderReady(): string {
    if (this.readyProviderPath) {
      return this.readyProviderPath;
    }
    if (process.platform !== 'linux') {
      throw new SecurityBoundaryError(
        'SANDBOX_UNAVAILABLE',
        'Restrictive execution requires the Linux Bubblewrap sandbox provider.',
        { platform: process.platform }
      );
    }

    const providerPath = this.resolveProviderPath();
    this.validateProviderIdentity(providerPath);
    this.readyProviderVersion = this.probeProvider(providerPath);
    this.readyProviderPath = providerPath;
    return providerPath;
  }

  private resolveProviderPath(): string {
    const candidates = this.requestedProviderPath
      ? [this.requestedProviderPath]
      : ['/usr/bin/bwrap', '/bin/bwrap'];

    for (const candidate of candidates) {
      try {
        return realpathSync.native(candidate);
      } catch {
        // Try the next trusted installation path.
      }
    }

    throw new SecurityBoundaryError(
      'SANDBOX_UNAVAILABLE',
      'Restrictive execution is unavailable because Bubblewrap was not found.',
      { configuredProvider: this.requestedProviderPath || null }
    );
  }

  private validateProviderIdentity(providerPath: string): void {
    const stats = statSync(providerPath);
    const allowedOwners = new Set([0]);
    if (typeof process.getuid === 'function') {
      allowedOwners.add(process.getuid());
    }
    if (!stats.isFile() || (stats.mode & 0o022) !== 0 || !allowedOwners.has(stats.uid)) {
      throw new SecurityBoundaryError(
        'SANDBOX_CAPABILITY_MISSING',
        'The Bubblewrap provider must have a trusted owner and must not be group- or world-writable.',
        { providerPath, ownerUid: stats.uid }
      );
    }

    if (this.approvedRoots.some((root) => isPathWithin(root, providerPath))) {
      throw new SecurityBoundaryError(
        'SANDBOX_CAPABILITY_MISSING',
        'The Bubblewrap provider cannot be loaded from an approved command workspace.',
        { providerPath }
      );
    }
  }

  private probeProvider(providerPath: string): string {
    const versionResult = spawnSync(providerPath, ['--version'], {
      cwd: '/',
      env: {},
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const version = versionResult.stdout.trim();
    if (versionResult.error || versionResult.status !== 0 || !/^bubblewrap \d+\.\d+\.\d+$/.test(version)) {
      throw new SecurityBoundaryError(
        'SANDBOX_CAPABILITY_MISSING',
        'The Bubblewrap provider did not return a recognized version.',
        { providerPath, status: versionResult.status }
      );
    }

    const result = spawnSync(
      providerPath,
      [...this.buildBaseProfileArgs(), '--chdir', '/tmp', '--', '/usr/bin/true'],
      {
        cwd: '/',
        env: {},
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    if (result.error || result.status !== 0) {
      throw new SecurityBoundaryError(
        'SANDBOX_CAPABILITY_MISSING',
        'Bubblewrap could not establish the required restrictive sandbox profile.',
        {
          providerPath,
          status: result.status,
          signal: result.signal,
          error: result.error?.message,
          stderr: result.stderr?.slice(0, 500),
        }
      );
    }
    return version;
  }

  private buildBaseProfileArgs(): string[] {
    const args = [
      '--unshare-user',
      '--unshare-ipc',
      '--unshare-pid',
      '--unshare-net',
      '--unshare-uts',
      '--disable-userns',
      '--uid',
      '65534',
      '--gid',
      '65534',
      '--cap-drop',
      'ALL',
      '--die-with-parent',
      '--new-session',
      '--clearenv',
      '--ro-bind',
      '/usr',
      '/usr',
    ];

    for (const [legacyPath, usrTarget] of [
      ['/bin', 'usr/bin'],
      ['/lib', 'usr/lib'],
      ['/lib64', 'usr/lib64'],
    ] as const) {
      if (!existsSync(legacyPath)) {
        continue;
      }
      if (!lstatSync(legacyPath).isSymbolicLink() || readlinkSync(legacyPath) !== usrTarget) {
        throw new SecurityBoundaryError(
          'SANDBOX_CAPABILITY_MISSING',
          'The restrictive profile requires a usr-merged runtime layout.',
          { legacyPath, expectedTarget: usrTarget }
        );
      }
      args.push('--symlink', usrTarget, legacyPath);
    }

    args.push(
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--size',
      String(SANDBOX_TMP_BYTES),
      '--tmpfs',
      '/tmp',
      '--dir',
      '/tmp/home',
      '--setenv',
      'PATH',
      '/usr/bin:/bin',
      '--setenv',
      'HOME',
      '/tmp/home',
      '--setenv',
      'TMPDIR',
      '/tmp',
      '--setenv',
      'LANG',
      'C.UTF-8'
    );
    return args;
  }

  private selectWorkspaceRoot(canonicalCwd: string): string {
    const root = this.approvedRoots.find((candidate) => isPathWithin(candidate, canonicalCwd));
    if (!root) {
      throw new SecurityBoundaryError(
        'SANDBOX_SETUP_FAILED',
        'The working directory is outside the approved sandbox workspace roots.',
        { workingDirectory: canonicalCwd }
      );
    }
    if (!statSync(root).isDirectory() || !statSync(canonicalCwd).isDirectory()) {
      throw new SecurityBoundaryError(
        'SANDBOX_SETUP_FAILED',
        'The sandbox workspace root and working directory must be directories.',
        { workspaceRoot: root, workingDirectory: canonicalCwd }
      );
    }
    return root;
  }
}
