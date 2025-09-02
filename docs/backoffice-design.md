# Backoffice Web Server Design (Phase 1)

Scope: Monitoring dashboard to view command history, execution results, and terminal list. Localhost only; no authentication for now.

## Goals
- Read-only dashboard
- Show: (1) command history, (2) executions, (3) terminals
- Safe with MCP stdio: no console.log noise; use internal logger

## Architecture
- In-process HTTP server (`src/backoffice/server.ts`), Node http module (no extra deps)
- Bound to 127.0.0.1, port BACKOFFICE_PORT (default 3030)
- Enabled via env: BACKOFFICE_ENABLED=true
- Static UI `/public` (index.html, styles.css, main.js)

## APIs
- GET `/api/history`
  - Query: page (1), page_size (20), q, wd, executed, safety, date_from, date_to
  - Response: entries[] + pagination
- GET `/api/history/:id`
  - Response: full entry
- GET `/api/executions`
  - Query: limit (20), status (all|running|completed|failed|timeout), q
  - Response: { processes, total_count, filtered_count }
- GET `/api/executions/:id`
  - Response: ExecutionInfo
- GET `/api/executions/:id/outputs`
  - Response: File list metadata from FileManager
- GET `/api/terminals`
  - Query: status (all|active|idle|closed), session_name_pattern, limit
  - Response: { terminals, total }
- GET `/api/terminals/:id`
  - Response: TerminalInfo
- GET `/api/terminals/:id/output`
  - Query: start_line, line_count, include_ansi, include_foreground_process
  - Response: output slice

## Security
- Localhost only check using socket remoteAddress
- No auth (Phase 1); plan token/basic in Phase 2
- No CORS; UI served from same origin

## UI
- Single page with three tabs (history, executions, terminals)
- Lightweight CSS and fetch calls to APIs
- Auto refresh on page load; manual refresh buttons per tab

## Wiring
- `MCPShellServer` constructs `BackofficeServer` when BACKOFFICE_ENABLED=true and starts it.
- On cleanup, backoffice server is stopped.

## Next (Phase 2)
- Authentication (token/basic), CSRF protection
- Detail views (execution output preview, history->execution linkage)
- Streaming/live updates
- Filters/pagination on UI
