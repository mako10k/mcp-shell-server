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
- POST /v1/exec → { execution_id, status: 'accepted' } (implemented)
- POST /v1/exec accepts optional safety_evaluation (validator result from MCP) and stores it.
- GET /v1/exec/:id → returns minimal state { execution_id, command?, status, created_at, updated_at, safety_evaluation? }
- GET /v1/exec/:id/outputs → { execution_id, stdout?, stderr? }
- POST /v1/exec/:id/kill → { success, execution_id, signal_sent?, message? }
- Future: outputs, terminals, kill, stream.

## Env & Ports
- EXECUTOR_PORT=4030 (default), EXECUTOR_HOST=127.0.0.1
- EXECUTION_BACKEND=local|remote (available; default local). When 'remote', ShellTools delegates shell_execute/process_get_execution via RemoteProcessService.

## Frontend Integration (Phase 1 minimal)
- Added RemoteHttpClient and RemoteProcessService (start/get).
- ShellTools switches to remote when EXECUTION_BACKEND=remote for shell_execute/get_execution. RemoteProcessService also supports outputs/kill for diagnostics.
- Next: remote adapters for terminal/file and full parity.

## How to run (local dev)

1) Start executor (localhost-only):

```bash
npm run executor:dev
```

2) Verify health:

```bash
curl -s http://127.0.0.1:4030/health | jq
```

3) Try minimal exec:

```bash
curl -s -X POST http://127.0.0.1:4030/v1/exec \
  -H 'Content-Type: application/json' \
  -d '{"command":"echo hello","safety_evaluation":{"evaluation_result":"allow","reasoning":"ok"}}' | jq

curl -s http://127.0.0.1:4030/v1/exec/<execution_id> | jq

# fetch outputs (during or after)
curl -s http://127.0.0.1:4030/v1/exec/<execution_id>/outputs | jq

# send kill (optional)
curl -s -X POST http://127.0.0.1:4030/v1/exec/<execution_id>/kill -H 'Content-Type: application/json' -d '{"signal":"SIGTERM","force":false}' | jq
```

4) Run MCP server with remote backend:

```bash
EXECUTION_BACKEND=remote npm run dev
```

## Security
- Localhost bind only in Phase 1, token header in Phase 1.5.
- Size/timeout limits enforced both sides.

## Tasks (Phase 1 Skeleton)
1) Add executor skeleton server with /health and POST /v1/exec. [Done]
2) Add shared types (zod later). [Pending]
3) Add remote client stubs. [Done]
4) Wire env switch for process start/get. [Done]
5) Update docs and backoffice notes. [Done]
6) Extend executor: outputs, terminals, kill, streaming. [Planned]

## Runtime behavior (Phase 1)

- Autostart: POST /v1/exec accepts and immediately starts the process (status: running)
- Status transitions: running → completed | failed（タイムアウト/シグナル/非ゼロ終了含む）
- Outputs: stdout/stderr は実行中も随時メモリに反映（GET /outputs で確認）
- Timeout: 既定60s（kill SIGTERM → 1s 後に SIGKILL フォロー）
- Limits: max_output_size（既定5MB）で切り詰め
- Safety: safety_evaluation を保持し、/v1/exec/:id で参照可能

### Error modes
- 400: command 未指定／execution_id 無効
- 403: 非ローカルアクセス
- 404: 対象なし
- 500: 内部エラー／kill 失敗
