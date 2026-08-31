# Program Guard for Terminal Input

Program Guard is an optional `send_to` check on `terminal_operate` input. When
`send_to` is present, the server inspects the detected foreground process and
compares it with the requested target before writing input to the host terminal.

Terminal creation and input are unavailable in `restrictive` mode.

## Target forms

| Target | Example | Match |
| --- | --- | --- |
| Process name | `bash` | exact process name |
| Executable path | `/usr/bin/bash` | exact resolved executable path |
| PID | `pid:12345` | exact PID |
| Session leader | `sessionleader:` | foreground process is the session leader |
| Login/session leader alias | `loginshell:` | same session-leader check |
| Explicit bypass | `*` | accepts any detected target without comparison |

If `send_to` is omitted, no Program Guard comparison is performed. Use `*`
only when that explicit bypass is intended.

## Requests

Send input only when the foreground process name is `bash`:

```json
{
  "terminal_id": "terminal_123",
  "input": "echo hello",
  "execute": true,
  "send_to": "bash",
  "get_output": true
}
```

Send Ctrl+C only to a specific PID:

```json
{
  "terminal_id": "terminal_123",
  "input": "^C",
  "execute": false,
  "control_codes": true,
  "send_to": "pid:12345",
  "get_output": true
}
```

Target the detected session leader:

```json
{
  "terminal_id": "terminal_123",
  "input": "logout",
  "execute": true,
  "send_to": "sessionleader:"
}
```

## Response and failures

A successful `terminal_operate` response contains the terminal ID, success
state, optional terminal metadata, and optional output:

```json
{
  "terminal_id": "terminal_123",
  "success": true,
  "output": "hello\n",
  "output_info": {
    "line_count": 1,
    "total_lines": 1,
    "has_more": false,
    "start_line": 0,
    "next_start_line": 1
  }
}
```

The unified response does not currently expose the internal guard-check object.
If target verification fails, `terminal_operate` returns an MCP tool error with
`code` `EXECUTION_001`.

## Detection limits

- Foreground-process discovery depends on host process information. The current
  implementation uses Linux `/proc` data and a child-process heuristic.
- If process information is unavailable, Program Guard rejects a requested
  target rather than assuming a match.
- Process identity can change after inspection and before the PTY write.
  Program Guard is a point-in-time application check, not an OS isolation
  boundary.
- It does not apply when `send_to` is omitted and is explicitly bypassed by
  `send_to: "*"`.
- Control-code input is not added to normal command history.

See [Control Codes](control-codes.md) for accepted control-code text forms.
