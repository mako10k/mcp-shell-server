# MCP Shell Server VS Code Extension

This extension registers MCP Shell Server as an MCP server in VS Code so it can be selected from the MCP server list.

## Development

- Install dependencies in this folder: `npm install`
- Build the extension: `npm run build`

The build first compiles the repository-root server, then uses that exact build
for both direct Language Model Tools and the bundled MCP server. The package
dependency supplies runtime dependencies needed by the packaged VSIX.

For `shell_execute` and `terminal_operate`, the confirmation UI and dispatch
both consume the same validated execution-intent model. The confirmation keeps
command and input whitespace intact and states the terminal target, Enter and
control-code behavior, program guard, working directory, standard input, and
environment overrides that affect execution.

## Execution boundary

> [!WARNING]
> Confirmation tells you what the extension is about to execute or send; it is
> not an operating-system sandbox. The default `permissive` mode executes
> commands directly on the host. `moderate`, `enhanced`, and `enhanced-fast`
> also use direct host execution. Only `shell_execute` in `restrictive` mode
> uses the required Bubblewrap profile. Host terminals, remote execution,
> detached execution, and request environment overrides are unavailable in
> `restrictive` mode rather than being silently run outside that profile.
