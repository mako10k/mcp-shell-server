# VS Code Setup Guide

## Installation

1. Install the MCP Shell Server via npm:
```bash
npm install -g @mako10k/mcp-shell-server
```

## Configuration

### Workspace Configuration (Recommended)
Create or edit `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "mcp-shell-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["@mako10k/mcp-shell-server"],
      "env": {
        "MCP_SHELL_SECURITY_MODE": "permissive",
        "MCP_SHELL_DEFAULT_WORKDIR": "${workspaceFolder}",
        "MCP_SHELL_ALLOWED_WORKDIRS": "${workspaceFolder}"
      }
    }
  }
}
```

### User Configuration
Alternatively, configure in VS Code settings:

1. Open VS Code Settings (Cmd/Ctrl + ,)
2. Search for "MCP"
3. Add server configuration in the MCP Servers section

## Environment Variables

- `${workspaceFolder}`: Current workspace root directory
- `MCP_SHELL_SECURITY_MODE`: Execution mode boundary. `permissive` is direct host execution; Linux `restrictive` requires Bubblewrap.
- `MCP_SHELL_DEFAULT_WORKDIR`: Default working directory for commands
- `MCP_SHELL_ALLOWED_WORKDIRS`: Comma-separated list of narrow approved project roots. Restrictive mode can read regular files below the selected root; do not include home directories, credential trees, or shared host `/tmp`.

## Usage

Once configured, MCP Shell Server tools are available through the MCP tool
picker in GitHub Copilot Chat. The public surface covers command execution,
retained outputs, host terminals, and command history.

## Features

- **Shell Execution**: Run commands using the configured execution mode
- **Terminal Management**: Create and manage interactive terminals
- **Execution State**: Query background and adaptive executions
- **Retained Outputs**: Read, delete, and clean up command output
- **Execution Boundary**: Linux restrictive mode uses Bubblewrap for supported local non-interactive commands

## Team Sharing

The `.vscode/mcp.json` file can be committed to your repository to share MCP server configurations with your team.

The configuration above explicitly selects `permissive` and therefore executes
commands directly on the host. Working-directory validation is not a child
process sandbox. On Linux, use `restrictive` when the documented Bubblewrap
boundary and its route limitations match the workspace.
