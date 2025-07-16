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
        "MCP_SHELL_DEFAULT_WORKDIR": "${workspaceFolder}",
        "MCP_SHELL_ALLOWED_WORKDIRS": "${workspaceFolder},/tmp"
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
- `MCP_SHELL_DEFAULT_WORKDIR`: Default working directory for commands
- `MCP_SHELL_ALLOWED_WORKDIRS`: Comma-separated list of allowed directories
- `MCP_LOG_LEVEL`: Logging level (debug, info, warn, error)

## Usage

Once configured, the MCP Shell Server tools will be available in GitHub Copilot Chat:
- Use `@shell` to execute shell commands
- Access terminal management features
- Monitor running processes
- Manage execution outputs

## Features

- **Shell Execution**: Run commands with security restrictions
- **Terminal Management**: Create and manage interactive terminals
- **Process Monitoring**: Track running processes and resource usage
- **File Operations**: Read and manage command output files
- **Security Controls**: Directory restrictions and process limits

## Team Sharing

The `.vscode/mcp.json` file can be committed to your repository to share MCP server configurations with your team.
