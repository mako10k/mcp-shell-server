# Claude Desktop Setup Guide

## Installation

1. Install the MCP Shell Server via npm:
```bash
npm install -g @mako10k/mcp-shell-server
```

## Configuration

### macOS
Edit your Claude Desktop configuration file:
```bash
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

### Windows
Edit your Claude Desktop configuration file:
```powershell
code "$env:APPDATA\Claude\claude_desktop_config.json"
```

### Configuration Content
Add the following to your configuration file:

```json
{
  "mcpServers": {
    "mcp-shell-server": {
      "command": "npx",
      "args": ["@mako10k/mcp-shell-server"],
      "env": {
        "MCP_SHELL_SECURITY_MODE": "permissive",
        "MCP_SHELL_DEFAULT_WORKDIR": "/your/preferred/working/directory",
        "MCP_SHELL_ALLOWED_WORKDIRS": "/your/preferred/working/directory"
      }
    }
  }
}
```

## Environment Variables

- `MCP_SHELL_SECURITY_MODE`: Execution mode boundary. `permissive` is direct host execution; Linux `restrictive` requires Bubblewrap.
- `MCP_SHELL_DEFAULT_WORKDIR`: Default working directory for commands
- `MCP_SHELL_ALLOWED_WORKDIRS`: Comma-separated list of narrow approved project roots. Restrictive mode can read regular files below the selected root; do not include home directories, credential trees, or shared host `/tmp`.

## Usage

After restarting Claude Desktop, the server provides command execution,
retained-output management, host-terminal operations, and command-history
queries.

## Execution boundary

The configuration above explicitly selects `permissive`, which executes
commands directly on the host. `MCP_SHELL_ALLOWED_WORKDIRS` restricts accepted
working-directory values but does not confine child-process filesystem or
network access.

On Linux with a reviewed Bubblewrap installation, change the mode to
`restrictive` for supported local non-interactive commands. Restrictive mode
does not provide interactive terminals, remote execution, detached execution,
or request environment overrides.
