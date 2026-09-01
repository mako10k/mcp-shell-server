# Terminal Control Codes

Public control-code input is provided through the `terminal_operate` tool.
Terminal creation and input use host terminals and are unavailable in
`restrictive` mode.

## Basic request

Set `control_codes` to true. Set `execute` to false unless an additional Enter
key should be sent after the control sequence.

```json
{
  "terminal_id": "terminal_123",
  "input": "^C",
  "execute": false,
  "control_codes": true,
  "get_output": true
}
```

## Accepted text forms

`terminal_operate` passes control-code text to the terminal manager, which
recognizes these forms:

| Form | Examples |
| --- | --- |
| Ctrl notation | `^C`, `^D`, `^L`, `^Z` |
| Common escapes | `\n`, `\r`, `\t`, `\b`, `\f`, `\v`, `\0` |
| Hex escape | `\x1b`, `\x03` |
| Octal escape | `\033`, `\003` |
| Unicode escape | `\u001b`, `\u0003` |

The JSON representation must escape the backslash. For example, the text
`\x1b` is written as `"\\x1b"` in JSON.

## Examples

Interrupt the foreground process:

```json
{
  "terminal_id": "terminal_123",
  "input": "^C",
  "execute": false,
  "control_codes": true
}
```

Clear the terminal:

```json
{
  "terminal_id": "terminal_123",
  "input": "^L",
  "execute": false,
  "control_codes": true
}
```

Send Escape:

```json
{
  "terminal_id": "terminal_123",
  "input": "\\x1b",
  "execute": false,
  "control_codes": true
}
```

Send an ANSI sequence:

```json
{
  "terminal_id": "terminal_123",
  "input": "\\x1b[31mRed Text\\x1b[0m",
  "execute": false,
  "control_codes": true,
  "include_ansi": true
}
```

## Public boundary

The internal terminal manager contains a raw-byte helper, but version 2.8.1
does not expose `raw_bytes` in the public `terminal_operate` schema. Clients
must not send that parameter.

Control-code input is not added to normal command history. It can still change
or terminate the foreground process, so clients should use `send_to` when a
specific process identity is required. See [Program Guard](program-guard.md).
