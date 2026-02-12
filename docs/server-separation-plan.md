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

## Open Questions
- Required session metadata for re-attach (env, cwd, history, pty state).
- Token and authorization model for server attachment.
- Background daemon discovery mechanism (pidfile, socket, or registry).
