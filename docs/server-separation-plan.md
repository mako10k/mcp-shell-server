# Server Separation and Submodule Refactor Plan

## Goals
- Keep long-running processes alive across MCP/VSCode client shutdown.
- Enable re-attach to running processes, with directory-boundary security.
- Introduce a server management layer for lifecycle and attachment control.
- Prepare the repository for submodule-based separation.

## Non-Goals (Now)
- Cross-directory attachment for security reasons.
- Multi-host or remote orchestration.
- Auto-recovery that can bypass security checks.

## Assumptions
- The server daemon is started from the shared foundation via spawn or fork.
- Re-attach is only allowed within the same directory boundary by default.
- The same working directory auto-detects and auto-attaches to a running server.
- shell_execute and terminal_operate are both long-lived process users.

## Target Architecture (High-Level)
- Shared foundation (shell-server) hosts:
  - Process daemonization and lifecycle
  - Server management layer
  - Core execution and terminal services
- Interface layers (mcp-shell, code-shell-extension) are thin wrappers over the shared API.
- Backend layer (shell-server-backend) provides optional services, isolated by API.

## Server Management Layer
### Responsibilities
- Provide current server info for the active connection.
- List attachable servers (same directory boundary only).
- Start, stop, get, detach, and re-attach servers.
- Enforce security rules at the boundary.

### Proposed API Surface (Conceptual)
- server.current()
- server.listAttachable({ cwd })
- server.start({ cwd, options })
- server.stop({ serverId })
- server.get({ serverId })
- server.detach({ serverId })
- server.reattach({ serverId })

### Security Rules
- Enforce same-directory boundary by default.
- Fail fast on boundary violations or missing permissions.
- Avoid recovery paths that bypass auth checks.

## Process Model
- The shared foundation spawns or forks a daemon process.
- The daemon persists beyond the client lifetime.
- Clients connect to the daemon through the server management layer.

## Auto Start / Auto Re-attach
- If a daemon already exists in the same working directory, auto-attach on startup.
- If no daemon exists, auto-start and register metadata.
- Auto-attach must not cross directory boundaries.

## Repository Separation Strategy (Submodule-Based)
### Target Repositories
- mako10k/shell-server: shared foundation and server management layer
- mako10k/mcp-shell: MCP interface
- mako10k/code-shell-extension: VSCode interface
- mako10k/shell-server-backend: backend services

### New Directory Layout (Before Submodules)
- packages/
  - shell-server/
  - mcp-shell/
  - code-shell-extension/
  - shell-server-backend/

### Submodule Replacement Plan
1. Move code into packages/* in this repo first.
2. Extract each package into its own repository.
3. Replace the package directory with a git submodule.
4. Validate build and runtime behavior after each replacement.

## Refactoring Phases
### Phase 0: Boundary Definition
- Identify current modules and dependencies.
- Define shared API contracts and ownership.

### Phase 1: Directory Restructure (Monorepo-only)
- Move code into packages/*.
- Fix imports and build configs.
- Keep runtime behavior unchanged.

### Phase 1 Mapping Draft (Current -> packages)
- packages/shell-server/
  - src/core/
  - src/executor/
  - src/runtime/
  - src/security/
  - src/tools/
  - src/types/
  - src/utils/
  - src/backoffice/ (experimental; placement can be deferred)
- packages/mcp-shell/
  - src/index.ts (CLI entry at packages/mcp-shell/src/index.ts)
  - src/server.ts (MCP server wrapper at packages/mcp-shell/src/server.ts)
- packages/code-shell-extension/
  - vscode-mcp-shell/
- packages/shell-server-backend/
  - public/ (backoffice UI assets)
  - docs/backoffice-design.md (if dedicated to backend)

Notes:
- This is an initial mapping and will be validated against runtime dependencies.
- Backoffice is experimental; placement can be deferred until its scope is fixed.

### Phase 1 Inventory (Current Entry Points)
- CLI entry: packages/mcp-shell/src/index.ts
- MCP server: packages/mcp-shell/src/server.ts
- Executor backend: packages/shell-server/src/executor/server.ts
- Backoffice UI server: packages/shell-server/src/backoffice/server.ts
- Backoffice entry: packages/shell-server/src/backoffice/index.ts
- Tool runtime export: packages/shell-server/src/runtime/tool-runtime.ts
- VSCode extension: packages/code-shell-extension/vscode-mcp-shell/

### Phase 1 Inventory (Core Dependency Hubs)
- Tool runtime (packages/shell-server/src/runtime/tool-runtime.ts)
  - core: ConfigManager, ProcessManager, TerminalManager, FileManager,
    MonitoringManager, CommandHistoryManager
  - tools: ShellTools
  - security: SecurityManager, evaluator types
  - utils: logger
  - types: EnhancedSecurityConfig
- Shell tools (packages/shell-server/src/tools/shell-tools.ts)
  - core: ProcessManager, TerminalManager, FileManager, MonitoringManager
  - security: SecurityManager
  - types: schemas, quick-schemas, shared types
  - utils: errors, criteria-manager
- Process manager (packages/shell-server/src/core/process-manager.ts)
  - types: execution and output models
  - utils: helpers, errors
  - core: terminal-manager, file-manager
  - streaming: stream-publisher, subscribers, pipeline reader
- Terminal manager (packages/shell-server/src/core/terminal-manager.ts)
  - types: terminal models
  - utils: helpers, errors, process-utils
  - external: node-pty (lazy-loaded)

### Phase 1 Move Order (Suggested)
1. Create packages/ skeletons and move shared types and utils into
   packages/shell-server/src/types and packages/shell-server/src/utils.
2. Move core managers (core/*) into packages/shell-server/src/core and adjust
   internal imports to the new root.
3. Move runtime and tools into packages/shell-server/src/runtime and
   packages/shell-server/src/tools.
4. Move security modules into packages/shell-server/src/security.
5. Move MCP entry points into packages/mcp-shell/src (index.ts, server.ts).
6. Move VSCode extension into packages/code-shell-extension/.
7. Move executor backend entry into packages/shell-server/src/executor.

### Phase 1 Cut Points (Interfaces)
- Shell runtime API boundary:
  - createShellToolRuntime, ShellToolRuntime types
- Tool surface boundary:
  - ShellTools methods used by MCP handlers
- Manager boundaries:
  - ProcessManager, TerminalManager, FileManager, MonitoringManager,
    CommandHistoryManager

### Phase 1 Import Update Checklist
- Entry points:
  - packages/mcp-shell/src/index.ts
  - packages/mcp-shell/src/server.ts
  - packages/shell-server/src/executor/server.ts
  - packages/shell-server/src/backoffice/* (experimental; update only if moved)
- Shared runtime:
  - packages/shell-server/src/runtime/tool-runtime.ts
  - packages/shell-server/src/tools/shell-tools.ts
- Core managers and streaming:
  - packages/shell-server/src/core/process-manager.ts
  - packages/shell-server/src/core/terminal-manager.ts
  - packages/shell-server/src/core/file-manager.ts
  - packages/shell-server/src/core/monitoring-manager.ts
  - packages/shell-server/src/core/*-subscriber.ts and stream-publisher.ts
- Types and schemas:
  - packages/shell-server/src/types/index.ts
  - packages/shell-server/src/types/schemas.ts
  - packages/shell-server/src/types/quick-schemas.ts

### Phase 2: Foundation Consolidation
- Move daemon and server management into shell-server.
- Route shell_execute and terminal_operate through the shared API.

### Phase 3: Interface Thinning
- Make MCP and VSCode layers depend only on the shared API.
- Remove reverse dependencies and tighten boundaries.

### Phase 4: Submodule Cutover
- Extract shell-server and replace with submodule.
- Extract mcp-shell and code-shell-extension.
- Extract shell-server-backend last.

## Risks and Mitigations
- Session state mismatch: define precise session metadata and migration rules.
- Boundary enforcement regressions: add tests for boundary violations.
- Build fragmentation: add CI that validates each package in isolation.

## Validation and Testing
- Unit tests for server management layer and boundary checks.
- Integration tests for re-attach in same directory.
- Regression tests for shell_execute and terminal_operate.

## Rollout and Compatibility
- Preserve existing CLI/MCP/VSC usage during Phase 1-3.
- Publish compatibility notes when submodules are introduced.

## Decisions (Review 1)
- Session metadata scope for re-attach:
  - Existing running shell_execute or terminal_operate sessions are unchanged.
  - New executions or new terminals inherit the new env, cwd, and history.
  - Existing terminals keep running with their current pty state.
- Attachment authorization:
  - Use a Unix domain socket with permissions 600.
  - Access is limited to the same OS user by file permissions.

## Open Questions (Review 2)
- Detach and re-attach semantics:
  - What happens to active streams during detach.
  - Whether a detaching client can force-close a session.
- Process ownership and cleanup:
  - How orphaned daemons are detected and terminated.
  - Default TTL for inactive sessions.

## Recommendation
- Prefer Option B: per-directory discovery using a socket file outside the
  workdirectory to keep codebases clean. Use a per-user runtime directory
  (e.g., $XDG_RUNTIME_DIR/mcp-shell/<hash>/daemon.sock) to enforce the
  directory boundary while avoiding workspace pollution. The socket file is
  created with 600 permissions and removed on clean shutdown. A stale socket
  can be detected by a failed connect and cleaned up.

## Decisions (Review 2)
- Daemon discovery:
  - Use per-directory discovery with a socket file in the per-user runtime.
- Detach behavior:
  - Detach when switching to a new server connection (close existing).
  - Detach implicitly when the client process exits.
  - Output during detach is canceled by default, but may vary by context.
- Attach eligibility:
  - Attach is allowed when the server has not been attached yet or is detached.
  - Attach is rejected while a server is already attached.
- Orphan handling and limits:
  - shell_execute uses its timeout policy for cleanup.
  - terminal_operate is persistent by default or uses a long TTL
    (e.g., 86400 seconds).
  - Enforce soft and hard concurrency limits to encourage reuse and cleanup.
- Socket and runtime cleanup rules:
  - On discovery, if a socket path exists but connect fails, treat it as stale
    and delete the socket file.
  - After removing a stale socket, remove the branch directory if empty.
  - After removing a branch directory, remove the hash directory if empty.
  - Cleanup is best-effort and must not delete non-empty directories.

## Directory Branching Rule (Multiple Servers per Directory)
- Allow multiple servers per directory by appending a branch suffix.
- Default branch is "main".
- The branch suffix is a safe identifier (e.g., "main", "work-1", "exp").
- The socket path includes the branch:
  - $XDG_RUNTIME_DIR/mcp-shell/<hash>/<branch>/daemon.sock
- The branch is provided explicitly when starting a server.
- Auto-attach uses the default branch unless a branch is specified.
