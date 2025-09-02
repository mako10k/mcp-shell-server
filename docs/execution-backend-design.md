# Execution Backend Separation Design (Draft / Phase 1)

This document proposes splitting command execution and terminal operations into a dedicated backend service, while keeping the MCP server as the secure “frontend”.

## Goals
- MCP server remains the frontend: security evaluation, history, backoffice UI.
- Execution/terminal/output handling moves to a separate local backend service.
- Keep local mode available; switchable via env.
- Read-only backoffice keeps working transparently.

## Architecture
- Frontend (MCP server):
  - Security evaluation, history, backoffice API/UI.
  - Delegates execution to Backend via HTTP(S)/SSE client.
- Backend (Execution service):
  - Start/monitor commands, terminals, store output chunks.
  - HTTP+JSON control, SSE (future) for streaming.
  - Binds to 127.0.0.1; token auth later.

## Phases
- Phase 1: Thin split with local|remote switch (default local). Minimal HTTP API, polling.
- Phase 1.5: Token, rate limiting, timeouts/cancel, health/metrics.
- Phase 2: SSE/WS streaming, data flow optimization.
- Phase 3: Sandbox/multi-workers.

## Backend API (initial minimal)
- GET /health → { status: 'ok', uptime_s, version }
- POST /v1/exec → { execution_id, status: 'accepted' } (skeleton)
- GET /v1/exec/:id → 501 Not Implemented (placeholder)
- Future: outputs, terminals, kill, stream.

## Env & Ports
- EXECUTOR_PORT=4030 (default), EXECUTOR_HOST=127.0.0.1
- EXECUTION_BACKEND=local|remote (planned; default local)

## Frontend Integration (planned)
- Add Remote*Service adapters implementing process/terminal/file service interfaces.
- Inject local or remote implementation based on env.

## Security
- Localhost bind only in Phase 1, token header in Phase 1.5.
- Size/timeout limits enforced both sides.

## Tasks (Phase 1 Skeleton)
1) Add executor skeleton server with /health and POST /v1/exec.
2) Add shared types (zod later).
3) Add remote client stubs (next step).
4) Wire env switch (next step).
5) Update docs and backoffice notes.
