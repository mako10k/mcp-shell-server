# MCP Shell Server

[![CI](https://github.com/mako10k/mcp-shell-server/workflows/CI/badge.svg)](https://github.com/mako10k/mcp-shell-server/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-0.6.0-purple.svg)](https://modelcontextprotocol.io/)
[![npm](https://img.shields.io/npm/v/@mako10k/mcp-shell-server.svg)](https://www.npmjs.com/package/@mako10k/mcp-shell-server)

A secure and comprehensive Model Context Protocol (MCP) server for shell operations, terminal management, and process control.

## 🚀 Quick Start

### Installation

Choose your preferred installation method:

#### Global Installation (Recommended)
```bash
npm install -g @mako10k/mcp-shell-server
```

#### Local Development Installation
```bash
git clone https://github.com/mako10k/mcp-shell-server.git
cd mcp-shell-server
npm install
npm run build
```

### Configuration for Popular MCP Clients

#### Claude Desktop
```json
{
  "mcpServers": {
    "mcp-shell-server": {
      "command": "mcp-shell-server"
    }
  }
}
```

*Note: After global installation, you can use `mcp-shell-server` directly or `npx @mako10k/mcp-shell-server`*

#### VS Code with GitHub Copilot
Create `.vscode/mcp.json`:
```json
{
  "servers": {
    "mcp-shell-server": {
      "type": "stdio",
      "command": "mcp-shell-server"
    }
  }
}
```

#### Cursor
Add to MCP settings:
```json
{
  "servers": {
    "mcp-shell-server": {
      "type": "stdio",
      "command": "mcp-shell-server"
    }
  }
}
```

📚 **[Detailed Setup Guides](docs/setup/)** | 📁 **[Configuration Examples](examples/)**

## 🎉 Status: Production Ready

✅ **COMPLETE** - The MCP Shell Server is fully implemented and ready for production use.

### Build Status
- ✅ TypeScript compilation successful
- ✅ All strict type checking passed
- ✅ Security validation working
- ✅ Core managers operational
- ✅ MCP integration complete

### Key Achievements
- 🔐 **Comprehensive Security**: Advanced command validation and sandboxing
- 🖥️ **18 MCP Tools**: Complete API covering all shell operations
- 📊 **Real-time Monitoring**: System and process metrics
- 🖥️ **Terminal Sessions**: Interactive PTY-based terminals
- 📁 **File Management**: Secure file operations and storage
- 🔌 **MCP Standards**: Full Model Context Protocol compliance

## Features

### 🛡️ Security-First Design
- Sandboxed command execution
- Configurable command restrictions
- Path access control
- Resource usage limits
- Real-time security monitoring

### 🔧 Shell Operations
- Multiple execution modes: foreground, background, detached, adaptive
- Background process management with timeout handling
- Configurable timeouts and output limits
- Environment variable control
- Input/output capture and partial output support

### 💻 Terminal Management
- Interactive terminal sessions
- Multiple shell support (bash, zsh, fish, PowerShell)
- **🆕 Control Code Support**: Send control characters and escape sequences
- **🆕 Program Guard**: Secure input targeting with process validation
- **🆕 Foreground Process Detection**: Real-time process information
- Resizable terminals
- Command history
- Real-time output streaming

### 🔐 Advanced Security Features
- **🆕 Program Guard System**: Prevents unintended input delivery
  - Target specific processes by name, path, or PID
  - Session leader detection and validation
  - Safe fallback behavior for unknown processes
- **🆕 Control Code Validation**: Secure handling of terminal control sequences
- Process isolation and sandboxing
- Configurable security restrictions

### 📁 File Operations
- Output file management
- Log file handling
- Temporary file storage
- Safe file reading with encoding support
- Batch file operations

### 📊 Monitoring & Statistics
- Real-time process monitoring
- System resource tracking
- Performance metrics
- Usage statistics
- Health monitoring

## Installation

```bash
# Clone the repository
git clone https://github.com/mako10k/mcp-shell-server.git
cd mcp-shell-server

# Install dependencies
npm install

# Build the project
npm run build
```

## Quick Start

```bash
# Start the MCP server
npm start

# Or run in development mode
npm run dev
```

### Using with MCP Client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js']
});

const client = new Client(
  { name: 'mcp-client', version: '1.0.0' },
  { capabilities: {} }
);

await client.connect(transport);

// Execute a shell command
const result = await client.request({
  method: 'tools/call',
  params: {
    name: 'shell_execute',
    arguments: {
      command: 'echo "Hello from MCP Shell Server!"',
      execution_mode: 'foreground'
    }
  }
});

console.log(result);
```

### 🆕 New Features in v2.1.0

#### Control Code Support
```typescript
// Send Ctrl+C to interrupt a process
await client.request({
  method: 'tools/call',
  params: {
    name: 'terminal_send_input',
    arguments: {
      terminal_id: 'terminal_123',
      input: '^C',
      control_codes: true
    }
  }
});

// Send ANSI escape sequences for colored output
await client.request({
  method: 'tools/call',
  params: {
    name: 'terminal_send_input',
    arguments: {
      terminal_id: 'terminal_123',
      input: '\\x1b[31mRed Text\\x1b[0m',
      control_codes: true
    }
  }
});
```

#### Program Guard Security
```typescript
// Only allow input to bash processes
await client.request({
  method: 'tools/call',
  params: {
    name: 'terminal_send_input',
    arguments: {
      terminal_id: 'terminal_123',
      input: 'echo "secure command"',
      send_to: 'bash',
      execute: true
    }
  }
});

// Target specific process by PID
await client.request({
  method: 'tools/call',
  params: {
    name: 'terminal_send_input',
    arguments: {
      terminal_id: 'terminal_123',
      input: '^C',
      send_to: 'pid:12345',
      control_codes: true
    }
  }
});
```

## Usage

### Basic Usage

```bash
npm start
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Testing

```bash
npm test
```

## Configuration

The server can be configured through environment variables or by calling the security restriction tools at runtime.

### Default Security Settings

- Blocked dangerous commands (rm, sudo, etc.)
- Limited to safe directories
- 5-minute execution timeout
- 1GB memory limit

### Disabling Tools
Set `MCP_DISABLED_TOOLS` to a comma-separated list of tool names to disable.
Disabled tools will not appear in the tool list and cannot be called.

### Environment Variables

The server supports the following environment variables for configuration:

#### General Configuration
- `MCP_DISABLED_TOOLS`: Comma-separated list of tool names to disable
  ```bash
  export MCP_DISABLED_TOOLS="terminal_create,process_terminate"
  ```

#### Working Directory Configuration
- `MCP_SHELL_DEFAULT_WORKDIR`: Set the default working directory for all command executions
  ```bash
  export MCP_SHELL_DEFAULT_WORKDIR="/home/user/projects"
  ```
- `MCP_SHELL_ALLOWED_WORKDIRS`: Comma-separated list of allowed working directories
  ```bash
  export MCP_SHELL_ALLOWED_WORKDIRS="/home/user,/tmp,/var/log"
  ```

#### Security Configuration
- `MCP_SHELL_SECURITY_MODE`: Set the default security mode (`permissive`, `restrictive`, or `custom`)
  ```bash
  export MCP_SHELL_SECURITY_MODE="restrictive"
  ```

#### Resource Limits
- `MCP_SHELL_MAX_EXECUTION_TIME`: Default maximum execution time in seconds
  ```bash
  export MCP_SHELL_MAX_EXECUTION_TIME="300"
  ```
- `MCP_SHELL_MAX_MEMORY_MB`: Default maximum memory usage in MB
  ```bash
  export MCP_SHELL_MAX_MEMORY_MB="1024"
  ```

#### Complete Configuration Example
```bash
# Security settings
export MCP_SHELL_SECURITY_MODE="restrictive"
export MCP_SHELL_MAX_EXECUTION_TIME="300"
export MCP_SHELL_MAX_MEMORY_MB="1024"

# Working directory settings
export MCP_SHELL_DEFAULT_WORKDIR="/home/user/projects"
export MCP_SHELL_ALLOWED_WORKDIRS="/home/user,/tmp"

# Tool restrictions
export MCP_DISABLED_TOOLS="process_terminate,delete_execution_outputs"

# Start the server
npm start
```

**Note**: Additional configuration options can be set at runtime using the `security_set_restrictions` tool for more granular control over allowed/blocked commands, directories, and other security parameters.

### Runtime Security Configuration

Use the `security_set_restrictions` tool to dynamically configure security settings:

```json
{
  "security_mode": "custom",
  "allowed_commands": ["ls", "cat", "grep"],
  "blocked_commands": ["rm", "sudo"],
  "allowed_directories": ["/tmp", "/home/user"],
  "max_execution_time": 300,
  "max_memory_mb": 1024
}
```

**Security Modes:**
- `permissive`: Allow most commands with basic safety checks
- `restrictive`: Only allow read-only commands (ls, cat, grep, etc.)
- `custom`: Use detailed configuration with allowed/blocked commands

## API Reference

### Shell Operations

#### `shell_execute`
Execute shell commands with various execution modes. Can also create new interactive terminal sessions.

**Parameters:**
- `command` (required): Command to execute
- `execution_mode`: Execution strategy for the command:
  - `'foreground'`: Wait for command completion within timeout_seconds. Best for quick commands
  - `'background'`: Run asynchronously, monitor via process_list. Best for long-running processes
  - `'detached'`: Fire-and-forget execution, minimal monitoring. Best for independent processes
  - `'adaptive'` (default): Start foreground for foreground_timeout_seconds, then switch to background if needed. Best for unknown execution times
- `working_directory`: Working directory
- `environment_variables`: Environment variables
- `timeout_seconds`: Maximum execution timeout (all modes respect this limit)
- `foreground_timeout_seconds`: For adaptive mode: initial foreground phase timeout (default: 10s)
- `return_partial_on_timeout`: Return partial output on timeout
- `max_output_size`: Maximum output size
- `create_terminal`: Create new interactive terminal session
- `terminal_shell`: Shell type for new terminal ('bash', 'zsh', 'fish', etc.)
- `terminal_dimensions`: Terminal dimensions {width, height}

**Examples:**

Regular command execution:
```json
{
  "command": "ls -la",
  "execution_mode": "foreground"
}
```

Adaptive execution with intelligent background transition:
```json
{
  "command": "long-running-process",
  "execution_mode": "adaptive",
  "foreground_timeout_seconds": 10,
  "timeout_seconds": 300,
  "return_partial_on_timeout": true
}
```

**Adaptive Mode Features:**
- Automatically transitions to background when `foreground_timeout_seconds` is reached
- Transitions to background when `max_output_size` is reached (for efficiency)
- Returns `transition_reason` in response: `"foreground_timeout"` or `"output_size_limit"`
- Captures partial output during transitions and saves to FileManager
- Single process execution (no duplicate commands)
- Respects total `timeout_seconds` limit for background phase

Create new terminal session:
```json
{
  "command": "vim file.txt", 
  "create_terminal": true,
  "terminal_shell": "bash",
  "terminal_dimensions": {"width": 120, "height": 40}
}
```

#### `process_get_execution`
Get detailed information about a command execution.

#### `shell_set_default_workdir`
Set the default working directory for command execution.

### Process Management

#### `process_list`
List running processes with filtering options.

#### `process_terminate`
Safely terminate processes with signal control.

#### `process_monitor`
Start real-time process monitoring.

### Terminal Management

#### `terminal_create`
Create interactive terminal sessions.

#### `terminal_send_input`
Send input to terminals.

#### `terminal_get_output`
Get terminal output with ANSI support.

#### `terminal_get_info`
Get detailed terminal information.

#### `terminal_resize`
Resize terminal dimensions.

#### `terminal_close`
Close terminal sessions.

### File Operations

#### `list_execution_outputs`
List managed output files with filtering.

#### `read_execution_output`
Read output file contents safely.

#### `delete_execution_outputs`
Delete output files with confirmation.

### Security & Monitoring

#### `security_set_restrictions`
Configure security restrictions.

#### `monitoring_get_stats`
Get system-wide statistics.

## Architecture

```
mcp-shell-server/
├── src/
│   ├── core/           # Core managers
│   │   ├── process-manager.ts
│   │   ├── terminal-manager.ts
│   │   ├── file-manager.ts
│   │   └── monitoring-manager.ts
│   ├── security/       # Security components
│   │   └── manager.ts
│   ├── tools/          # MCP tool handlers
│   │   └── shell-tools.ts
│   ├── types/          # Type definitions
│   │   ├── index.ts
│   │   └── schemas.ts
│   ├── utils/          # Utilities
│   │   ├── errors.ts
│   │   └── helpers.ts
│   ├── server.ts       # Main MCP server
│   └── index.ts        # Entry point
└── docs/
    └── specification.md
```

## Security Considerations

1. **Command Validation**: All commands are validated against security policies
2. **Path Restrictions**: File system access is limited to allowed directories  
3. **Resource Limits**: CPU, memory, and execution time limits are enforced
4. **Audit Logging**: All operations are logged for security auditing
5. **Sandboxed Execution**: Commands run in isolated environments

## Error Handling

The server provides comprehensive error handling with categorized error codes:

- `AUTH_*`: Authentication and authorization errors
- `PARAM_*`: Parameter validation errors  
- `RESOURCE_*`: Resource not found or limit errors
- `EXECUTION_*`: Command execution errors
- `SYSTEM_*`: System and internal errors
- `SECURITY_*`: Security policy violations

## Performance

- **Concurrent Processes**: Up to 50 simultaneous processes
- **Terminal Sessions**: Up to 20 active terminals
- **File Management**: Up to 10,000 managed files
- **Memory Efficient**: Automatic cleanup and garbage collection
- **Scalable**: Designed for high-throughput operations

## Platform Support

- ✅ Linux (Full support)
- ✅ macOS (Full support)
- ⚠️ Windows (Basic support)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Version History

### v2.0.0 (2025-06-13)
- Complete API redesign
- Enhanced security features
- Performance improvements
- New terminal management
- Comprehensive monitoring

## Documentation

### Core Documentation
- [API Specification](docs/specification.md) - Complete API reference
- [Control Codes Guide](docs/control-codes.md) - Terminal control sequences and escape codes
- [Program Guard Manual](docs/program-guard.md) - Security features and process targeting

### Examples
- [Control Codes Demo](examples/control-codes-demo.js) - Control code usage examples
- [Program Guard Demo](examples/program-guard-demo.js) - Security feature demonstrations

### Getting Started
- Review the [API Specification](docs/specification.md) for complete tool documentation
- Check out [Control Codes Guide](docs/control-codes.md) for advanced terminal features
- Learn about [Program Guard](docs/program-guard.md) for enhanced security
