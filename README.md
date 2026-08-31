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

After installation, verify the CLI:
```bash
mcp-shell-server --version
mcp-shell-server --help
```

#### Local Development Installation
```bash
git clone https://github.com/mako10k/mcp-shell-server.git
cd mcp-shell-server
npm install
npm run build
```

You can also link locally for user-level usage without sudo:
```bash
npm link
mcp-shell-server --help
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
      "command": "mcp-shell-server",
      "env": {
        "MCP_SHELL_SECURITY_MODE": "enhanced",
        "MCP_SHELL_ELICITATION": "true"
      }
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
- 🔐 **Explicit Security Boundaries**: Bubblewrap-backed restrictive execution and clearly identified unconfined modes
- 🖥️ **18 MCP Tools**: Complete API covering all shell operations
- 📊 **Real-time Monitoring**: System and process metrics
- 🖥️ **Terminal Sessions**: Interactive PTY-based terminals
- 📁 **File Management**: Secure file operations and storage
- 🔌 **MCP Standards**: Full Model Context Protocol compliance

## Features

### 🛡️ Security-First Design
- Bubblewrap sandboxing for restrictive local non-interactive execution
- Fail-closed unsupported restrictive routes
- Canonical request-path validation
- Execution-time and output limits
- Real-time security monitoring

### 🔧 Shell Operations
- Multiple execution modes: foreground, background, detached, adaptive
- **🆕 Pipeline Feature**: Command chaining with `input_output_id` parameter
- **🆕 Intelligent Guidance**: Adaptive mode provides usage hints when commands transition to background
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
- **🆕 Enhanced Safety Evaluator**: AI-powered command safety analysis
  - LLM-based security evaluation with detailed reasoning
  - Context-aware risk assessment
  - Intelligent alternative suggestions
  - Built-in user intent elicitation for complex scenarios
- **🆕 Program Guard System**: Prevents unintended input delivery
  - Target specific processes by name, path, or PID
  - Session leader detection and validation
  - Safe fallback behavior for unknown processes
- **🆕 Control Code Validation**: Secure handling of terminal control sequences
- Mode-specific isolation receipts
- Explicit migration failure for legacy custom command lists

### 📁 File Operations
- Output file management
- **🆕 Automatic Cleanup**: Smart suggestions for old file cleanup with configurable retention policies
- **🆕 Storage Analysis**: Real-time disk usage monitoring and optimization recommendations
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

### 🆕 New Features in v2.1.8

#### Intelligent Command Guidance
Automatic guidance when commands transition to background execution:
```typescript
// When a command times out or exceeds size limits, get helpful guidance
const result = await client.request({
  method: 'tools/call',
  params: {
    name: 'shell_execute',
    arguments: {
      command: 'find /usr -name "*.so"',
      execution_mode: 'adaptive',
      max_output_size: 1024
    }
  }
});

// Response includes guidance for pipeline processing
console.log(result.guidance.pipeline_usage);
// "input_output_id" reads the retained transition snapshot; wait for completion for final output.
```

#### Automatic File Cleanup
Smart cleanup suggestions and automated maintenance:
```typescript
// Get cleanup suggestions
const suggestions = await client.request({
  method: 'tools/call',
  params: {
    name: 'get_cleanup_suggestions',
    arguments: {
      max_age_hours: 24,
      max_size_mb: 50
    }
  }
});

// Perform automatic cleanup with retention policies
const cleanup = await client.request({
  method: 'tools/call',
  params: {
    name: 'perform_auto_cleanup',
    arguments: {
      dry_run: false,
      max_age_hours: 24,
      preserve_recent: 10
    }
  }
});
```

### 🆕 Previous Features in v2.1.0

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

### CLI Usage

```bash
mcp-shell-server --help
mcp-shell-server --version
```

The server supports various environment variables (see sections below), such as:
- `BACKOFFICE_ENABLED`, `BACKOFFICE_PORT`
- `EXECUTION_BACKEND` and `EXECUTOR_*` for remote executor
- `MCP_SHELL_DEFAULT_WORKDIR`, `MCP_SHELL_ALLOWED_WORKDIRS`
- `MCP_DISABLED_TOOLS`, `LOG_LEVEL`

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

The server security mode and trusted workspace roots are startup configuration supplied through environment variables. They are not mutable through the public MCP tool surface.

### Default Security Settings

- The default mode is `permissive`: commands execute directly on the host and are not blocked by a command allow/block policy
- Working-directory roots limit which existing directory may be selected; this validation is not a child-process sandbox or filesystem confinement boundary
- 5-minute execution timeout
- Bounded retained command output; no per-process CPU, PID, or memory containment

Use `MCP_SHELL_SECURITY_MODE=restrictive` on Linux with Bubblewrap for the fail-closed
`restrictive-v1` sandbox. Other modes remain direct host execution; legacy `custom` command-list
configuration requires migration and does not execute.

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
  export MCP_SHELL_ALLOWED_WORKDIRS="/home/user/projects/project-a,/home/user/projects/project-b"
  ```

#### Security Configuration
- `MCP_SHELL_SECURITY_MODE`: Set the default security mode (`permissive`, `restrictive`, `enhanced`, `enhanced-fast`, or `custom`)
  ```bash
  export MCP_SHELL_SECURITY_MODE="enhanced"
  ```
- `MCP_SHELL_BWRAP_PATH`: Optional trusted absolute path to Bubblewrap. Restrictive mode otherwise checks `/usr/bin/bwrap` and `/bin/bwrap`.
- `MCP_SHELL_ELICITATION`: Enable user intent elicitation for complex scenarios (for enhanced modes)
  ```bash
  export MCP_SHELL_ELICITATION="true"
  ```
- `MCP_SHELL_LLM_API_KEY`: API key for LLM-based safety evaluation (optional, falls back to MCP sampling)
- `MCP_SHELL_LLM_TIMEOUT`: Timeout for LLM evaluation in seconds (default: 30)

#### Execution Limits
- `MCP_SHELL_MAX_EXECUTION_TIME`: Default maximum execution time in seconds
  ```bash
  export MCP_SHELL_MAX_EXECUTION_TIME="300"
  ```

Per-process memory is not limited by this server. Apply an external cgroup or service-manager limit when memory containment is required.

#### Complete Configuration Example
```bash
# Security settings
export MCP_SHELL_SECURITY_MODE="restrictive"
export MCP_SHELL_MAX_EXECUTION_TIME="300"

# Working directory settings
export MCP_SHELL_DEFAULT_WORKDIR="/home/user/projects"
export MCP_SHELL_ALLOWED_WORKDIRS="/home/user/projects/project-a"

# Tool restrictions
export MCP_DISABLED_TOOLS="process_terminate,delete_execution_outputs"

# Start the server
npm start
```

**Note**: `restrictive` requires Linux and a successfully probed Bubblewrap provider. Provider absence or setup failure stops the request; it never falls back to direct host execution.

### Startup Security Configuration

Select the security mode with `MCP_SHELL_SECURITY_MODE` before starting the server. The public MCP API intentionally does not expose `security_set_restrictions`, because an evaluated client must not be able to downgrade its own execution boundary.

**Security Modes:**
- `permissive` / `moderate`: Direct, unconfined host execution. Command evaluation is not an OS isolation boundary.
- `restrictive`: Full Bash syntax runs inside `restrictive-v1`: approved workspace mounted read-only, private `/tmp`, fixed environment, and no IP network. Foreground, background, and adaptive local execution are supported. The enhanced evaluator is bypassed because OS confinement, rather than client sampling support, is the required execution gate.
- `enhanced` / `enhanced-fast`: LLM/Sampling evaluation followed by direct, unconfined host execution. Evaluation does not provide filesystem or process isolation.
- `custom`: Legacy command-list configurations return `CUSTOM_MODE_MIGRATION_REQUIRED` before process creation.

Restrictive mode temporarily rejects interactive terminals, remote execution, detached execution, request environment overrides, and workspaces containing special filesystem endpoints with stable `SANDBOX_*` codes in an MCP tool-error result's `structuredContent.code`. A successful response includes `execution_isolation` describing the actual launcher and profile.

## API Reference

### Shell Operations

#### `shell_execute`
Execute shell commands with various execution modes. Interactive terminal creation is unavailable in restrictive mode until a reviewed sandboxed PTY boundary is provided.

**Parameters:**
- `command` (required): Command to execute
- `execution_mode`: Execution strategy for the command:
  - `'foreground'`: Wait for command completion within timeout_seconds. Best for quick commands
  - `'background'`: Run asynchronously, monitor via process_list. Best for long-running processes
  - `'detached'`: Fire-and-forget execution, minimal monitoring. Best for independent processes
  - `'adaptive'` (default): Start foreground for foreground_timeout_seconds, then switch to background if needed. Best for unknown execution times
- `input_output_id`: Use output from another command as input (Pipeline feature)
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

**Pipeline Feature - Command Chaining:**
The MCP Shell Server supports command chaining through the Pipeline feature, allowing output from one command to be used as input for another command:

```json
// Step 1: Execute first command and get output_id
{
  "command": "cat input.txt",
  "execution_mode": "foreground"
}
// Response includes: "output_id": "abc123..."

// Step 2: Use output from first command as input for second command
{
  "command": "grep 'pattern'",
  "execution_mode": "foreground",
  "input_output_id": "abc123..."
}
```

**Important Notes:**
- Pipeline feature is different from shell pipes (`|`)
- Each command requires a separate `shell_execute` call
- Use `output_id` from first command's response as `input_output_id` for second command
- If the source execution is still running, `input_output_id` reads its retained transition snapshot; it is not a live stream. Wait for completion before consuming final output
- FileManager automatically handles data transfer between commands
- Supports large output files (up to 100MB)

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

1. **Execution Boundary**: Only restrictive local non-interactive execution is OS-confined by Bubblewrap; other modes are explicitly unconfined
2. **Path Validation**: Existing request paths and working directories use canonical component-boundary checks; this alone is not a child-process filesystem sandbox
3. **Resource Limits**: Execution-time and host-memory output-retention limits are enforced by the server; complete cgroup-backed CPU/memory containment is not provided
4. **Audit Logging**: All operations are logged for security auditing
5. **Fail-closed Sandbox**: Restrictive requests never fall back to host execution when Bubblewrap or a covered route is unavailable

Restrictive launch rejects observed sockets, FIFOs, devices, and unknown special entries below the approved root. Keep sensitive runtime endpoints outside approved roots: nested mounts, FUSE behavior, and concurrent host mutation after inspection remain outside this expedited profile's local-operator threat model.

Every readable regular file below the selected approved root is readable inside restrictive mode. Read-only prevents modification, not disclosure, so configure the narrowest project root and never approve a home directory or another tree containing credentials.

## Error Handling

The server provides categorized application error codes in MCP tool-error `structuredContent.code`:

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
