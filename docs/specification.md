# MCP Shell Server Specification

MCP Shell Server は、Model Context Protocol (MCP) を通じてコマンド実行、
保持出力、ホストターミナル、コマンド履歴を扱うサーバーです。

この文書は version 2.8.1 の public MCP tool surface を記述します。
実行時の正確な input schema は `tools/list` が返す JSON Schema を正とし、
実装上の登録箇所は `src/server.ts`、入力定義は
`src/types/schemas.ts` と `src/types/quick-schemas.ts` です。

## Server information

- Name: `mcp-shell-server`
- Package version: `2.8.1`
- Transport: stdio
- MCP implementation: `@modelcontextprotocol/sdk`。protocol version は client と SDK が接続時に negotiation する
- Direct-host platforms: Linux, macOS, Windows
- Restrictive boundary: Linux と Bubblewrap が必要

## Execution boundaries

- `permissive`: direct host execution。既定値
- `moderate`: direct host execution
- `enhanced` / `enhanced-fast`: LLM または sampling による評価後、direct host execution。評価は OS isolation ではない
- `restrictive`: 対応するローカル非対話コマンドを Bubblewrap の
  `restrictive-v1` profile で実行する
- `custom`: 旧 command-list 設定の移行専用。
  `CUSTOM_MODE_MIGRATION_REQUIRED` を process 作成前に返す

`restrictive-v1` は承認 workspace を read-only で公開し、private `/tmp`、
固定環境、IP network なしで実行します。Bubblewrap の不在・probe/setup
失敗時に direct host execution へ fallback しません。

Restrictive mode では interactive terminal、remote backend、detached execution、
request environment override、special filesystem endpoint を含む workspace を
拒否します。成功した command response は `execution_isolation` に実際の
launcher と profile を返します。

## Public tools

version 2.8.1 は次の13ツールを公開します。`MCP_DISABLED_TOOLS` に指定された
ツールは `tools/list` から除外され、呼び出しも拒否されます。

| Category | Tool |
| --- | --- |
| Command execution | `shell_execute` |
| Command execution | `process_get_execution` |
| Command execution | `shell_set_default_workdir` |
| Retained outputs | `list_execution_outputs` |
| Retained outputs | `read_execution_output` |
| Retained outputs | `delete_execution_outputs` |
| Retained outputs | `get_cleanup_suggestions` |
| Retained outputs | `perform_auto_cleanup` |
| Host terminals | `terminal_operate` |
| Host terminals | `terminal_list` |
| Host terminals | `terminal_get_info` |
| Host terminals | `terminal_close` |
| Command history | `command_history_query` |

旧名の `process_list`、`process_kill`、`process_terminate`、`process_monitor`、
`file_list`、`file_read`、`file_delete`、`terminal_create`、`terminal_input`、
`terminal_send_input`、`terminal_output`、`terminal_get_output`、
`terminal_resize`、`monitoring_get_stats` は public MCP tools ではありません。

## Tool contracts

### `shell_execute`

コマンドを選択済み execution mode と security mode で実行します。

主要 input:

| Field | Required | Default / constraint |
| --- | --- | --- |
| `command` | yes | non-empty string |
| `execution_mode` | no | `adaptive`; `foreground`, `background`, `detached`, `adaptive` |
| `working_directory` | no | current default working directory |
| `environment_variables` | no | restrictive mode では拒否 |
| `input_data` | no | `input_output_id` と同時指定不可 |
| `input_output_id` | no | retained output を stdin として使用 |
| `timeout_seconds` | no | 60 seconds; 1–3600 |
| `foreground_timeout_seconds` | no | 15 seconds; 1–300 |
| `return_partial_on_timeout` | no | `true` |
| `max_output_size` | no | 5 MiB; 1 KiB–100 MiB |
| `capture_stderr` | no | `true` |
| `session_id` | no | related execution grouping |
| `create_terminal` | no | `false`; restrictive mode では拒否 |
| `terminal_shell` | no | `bash`, `zsh`, `fish`, `cmd`, `powershell` |
| `terminal_dimensions` | no | width and height |
| `comment` | no | evaluator への advisory context |
| `force_user_confirm` | no | `false` |

`adaptive` は foreground window を超えた command を同一 execution ID の
background state へ移行できます。`input_output_id` は retained snapshot を
読み、live stream を意味しません。最終出力が必要な consumer は
`process_get_execution` で完了を確認してください。

代表的な response fields:

- `execution_id`, `status`, `working_directory`
- `stdout`, `stderr`, `exit_code`
- `output_id`, `output_status`, `output_truncated`
- `transition_reason`
- `execution_isolation`
- enhanced evaluation を使用した場合の `safety_evaluation`

### `process_get_execution`

`execution_id` を必須入力として、`shell_execute` が作成した execution の
status と保持済み情報を返します。background/adaptive execution の polling
にも使用します。

### `shell_set_default_workdir`

`working_directory` を必須入力として、以後の command execution の default
working directory を変更します。既存 path かつ
`MCP_SHELL_ALLOWED_WORKDIRS` の範囲内である必要があります。

### `list_execution_outputs`

retained output metadata を列挙します。

- `output_type`: `stdout`, `stderr`, `combined`, `log`, `all`
- `execution_id`: execution filter
- `name_pattern`: case-insensitive substring
- `limit`: default 100, maximum 1000

### `read_execution_output`

`output_id` を必須入力として retained output を読みます。

- `offset`: default 0
- `size`: default 8192 bytes, maximum 10 MiB
- `encoding`: default `utf-8`

### `delete_execution_outputs`

`output_ids` と `confirm` を必須入力として retained outputs を削除します。
`confirm` は `true` でなければ削除しません。

### `get_cleanup_suggestions`

retained output の age と storage usage を調べます。

- `max_size_mb`: default 50
- `max_age_hours`: default 24
- `include_warnings`: default true

### `perform_auto_cleanup`

retained output の cleanup policy を適用します。

- `max_age_hours`: default 24
- `dry_run`: default true
- `preserve_recent`: default 10

### `terminal_operate`

host terminal の作成、入力、resize、出力取得を統合した tool です。terminal
creation と input は restrictive mode では利用できません。

主要 input:

- `terminal_id`: 既存 terminal。省略時は `command` を指定して作成
- `command` / `input`: terminal へ送る text
- `execute`: default true
- `control_codes`: default false
- `send_to`: process name, path, `pid:12345`, `sessionleader:`, `*`
- `force_input`: default false
- `dimensions`: default 120 x 30
- `get_output`: default true
- `output_delay_ms`: default 500, maximum 10000
- `output_lines`: default 20, maximum 1000
- `include_ansi`: default false

Public `terminal_operate` schema は raw-byte hex input を公開しません。

### `terminal_list`

host terminal を列挙します。`session_name_pattern`、`status_filter`、
`limit`（default 50, maximum 200）を指定できます。

### `terminal_get_info`

`terminal_id` を必須入力として terminal metadata を返します。

### `terminal_close`

`terminal_id` を必須入力として terminal を閉じます。`save_history` の
default は true です。

### `command_history_query`

command history の pagination、検索、個別参照、analytics を一つの tool で
扱います。

- `page`: default 1
- `page_size`: default 20, maximum 100
- `query`, `command_pattern`, `working_directory`
- `safety_classification`, `was_executed`
- `date_from`, `date_to`
- `entry_id`
- `analytics_type`: `stats`, `patterns`, `top_commands`
- `include_full_details`: default false

Command history は完全な監査台帳ではありません。`shell_execute` の結果を
best-effort で記録し、他の public tool call すべてに durable record を保証しません。

## Startup configuration

主要な environment variables:

| Variable | Meaning |
| --- | --- |
| `MCP_SHELL_SECURITY_MODE` | security mode。default `permissive` |
| `MCP_SHELL_ALLOWED_WORKDIRS` | comma-separated approved working-directory roots |
| `MCP_SHELL_DEFAULT_WORKDIR` | initial default working directory |
| `MCP_SHELL_MAX_EXECUTION_TIME` | policy execution-time cap。default 300 seconds |
| `MCP_SHELL_BWRAP_PATH` | trusted absolute Bubblewrap provider path |
| `MCP_DISABLED_TOOLS` | comma-separated public tool names |
| `MCP_SHELL_ELICITATION` | enhanced mode elicitation |
| `MCP_SHELL_LLM_API_KEY` | optional evaluator API key |
| `MCP_SHELL_LLM_TIMEOUT` | evaluator timeout |
`MCP_SHELL_MAX_CONCURRENT`、`MCP_LOG_LEVEL`、`LOG_LEVEL` は version 2.8.1 の
configuration variables ではありません。同時 process 数の default limit は
50ですが、環境変数からは変更できません。

## Errors

`MCPShellError` は MCP tool error として `isError: true` を返し、同じ
error object を text content と `structuredContent` に含めます。

```json
{
  "code": "SANDBOX_UNAVAILABLE",
  "message": "The restrictive sandbox provider is unavailable.",
  "category": "SECURITY",
  "details": {},
  "timestamp": "2026-08-31T00:00:00.000Z"
}
```

`request_id` と `details` は存在する場合だけ含まれます。代表的な code は
`RESOURCE_001`、`RESOURCE_005`、`EXECUTION_001`、`EXECUTION_002`、
`SYSTEM_001`、`SECURITY_001`、`CUSTOM_MODE_MIGRATION_REQUIRED`、
`SANDBOX_*` です。固定一覧として推測せず、tool response の `code` と
`category` を処理してください。

## Operational records

- `shell_execute` が execution result を得た後、command history への追加を試みる
- history 保存失敗は command response 自体を失敗させず、warning を出す
- server、process、evaluator の一部 lifecycle/error event は logger または stderr に出る
- every MCP tool call の完全・tamper-evident・durable audit trail は提供しない

## Default limits

- Concurrent processes: 50
- Active terminals: 20
- Managed retained-output entries: 10,000
- `shell_execute` output: default 5 MiB, maximum 100 MiB
- Execution policy cap: default 300 seconds
- CPU, PID, and per-process memory containment: external cgroup または service manager が必要

## Examples

Foreground command:

```json
{
  "command": "pwd",
  "execution_mode": "foreground"
}
```

Adaptive command:

```json
{
  "command": "long-running-command",
  "execution_mode": "adaptive",
  "foreground_timeout_seconds": 15,
  "timeout_seconds": 300
}
```

Guarded terminal input:

```json
{
  "terminal_id": "terminal_123",
  "input": "^C",
  "execute": false,
  "control_codes": true,
  "send_to": "pid:12345"
}
```

## Change history

- 2.8.1: factual public metadata, aligned documentation inventory, and Sealgraph provenance checks
- 2.8.0: public tool surface and mode-specific execution-boundary contract
- Detailed release history: [CHANGELOG.md](../CHANGELOG.md)
