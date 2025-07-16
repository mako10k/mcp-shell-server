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
```bash
code %APPDATA%\Claude\claude_desktop_config.json
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
        "MCP_SHELL_DEFAULT_WORKDIR": "/your/preferred/working/directory",
        "MCP_SHELL_ALLOWED_WORKDIRS": "/your/allowed/directories,/tmp"
      }
    }
  }
}
```

## Environment Variables

- `MCP_SHELL_DEFAULT_WORKDIR`: Default working directory for commands
- `MCP_SHELL_ALLOWED_WORKDIRS`: Comma-separated list of allowed directories
- `MCP_SHELL_MAX_CONCURRENT`: Maximum concurrent processes (default: 50)
- `MCP_LOG_LEVEL`: Logging level (debug, info, warn, error)

## Usage

After restarting Claude Desktop, you'll have access to shell operations:
- Execute commands securely
- Manage terminal sessions
- Monitor processes
- Handle file operations

## Security

The server enforces directory restrictions and process limits for secure operation.
