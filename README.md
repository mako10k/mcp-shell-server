# MCP Shell Server

[![CI](https://github.com/mako10k/mcp-shell-server/workflows/CI/badge.svg)](https://github.com/mako10k/mcp-shell-server/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-0.6.0-purple.svg)](https://modelcontextprotocol.io/)

A secure and comprehensive Model Context Protocol (MCP) server for shell operations, terminal management, and process control.

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
- 🖥️ **16 MCP Tools**: Complete API covering all shell operations
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
- Synchronous and asynchronous command execution
- Background process management
- Configurable timeouts and output limits
- Environment variable control
- Input/output capture

### 💻 Terminal Management
- Interactive terminal sessions
- Multiple shell support (bash, zsh, fish, PowerShell)
- Resizable terminals
- Command history
- Real-time output streaming

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
      execution_mode: 'sync'
    }
  }
});

console.log(result);
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

The server can be configured through environment variables or by calling the security restriction tools.

### Default Security Settings

- Blocked dangerous commands (rm, sudo, etc.)
- Limited to safe directories
- 5-minute execution timeout
- 1GB memory limit
- Network access enabled

### Customizing Security

Use the `security_set_restrictions` tool to configure:

```json
{
  "allowed_commands": ["ls", "cat", "grep"],
  "blocked_commands": ["rm", "sudo"],
  "allowed_directories": ["/tmp", "/home/user"],
  "max_execution_time": 300,
  "max_memory_mb": 1024,
  "enable_network": false
}
```

## API Reference

### Shell Operations

#### `shell_execute`
Execute shell commands with various execution modes. Can also create new interactive terminal sessions.

**Parameters:**
- `command` (required): Command to execute
- `execution_mode`: 'sync', 'async', or 'background'
- `working_directory`: Working directory
- `environment_variables`: Environment variables
- `timeout_seconds`: Execution timeout
- `max_output_size`: Maximum output size
- `create_terminal`: Create new interactive terminal session
- `terminal_shell`: Shell type for new terminal ('bash', 'zsh', 'fish', etc.)
- `terminal_dimensions`: Terminal dimensions {width, height}

**Examples:**

Regular command execution:
```json
{
  "command": "ls -la",
  "execution_mode": "sync"
}
```

Create new terminal session:
```json
{
  "command": "vim file.txt", 
  "create_terminal": true,
  "terminal_shell": "bash",
  "terminal_dimensions": {"width": 120, "height": 40}
}
```

#### `shell_get_execution`
Get detailed information about a command execution.

### Process Management

#### `process_list`
List running processes with filtering options.

#### `process_kill`
Safely terminate processes with signal control.

#### `process_monitor`
Start real-time process monitoring.

### Terminal Management

#### `terminal_create`
Create interactive terminal sessions.

#### `terminal_input`
Send input to terminals.

#### `terminal_output`
Get terminal output with ANSI support.

### File Operations

#### `file_list`
List managed files with filtering.

#### `file_read`
Read file contents safely.

#### `file_delete`
Delete files with confirmation.

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
