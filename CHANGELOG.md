# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.2] - 2025-07-15

### Fixed
- **Issue #5**: Output file creation functionality
  - Fixed ProcessManager FileManager integration in server initialization
  - All command outputs (regardless of size) now consistently managed by FileManager
  - All outputs accessible via `list_execution_outputs` and `read_execution_output` tools
  - Added synchronous directory initialization to prevent timing issues

- **Issue #3**: Timeout behavior and execution mode improvements
  - Fixed adaptive mode timeout behavior to respect user-specified `timeout_seconds`
  - Improved adaptive mode to properly transition from foreground to background
  - Added background process timeout handling for comprehensive execution time limits
  - Fixed foreground timeout vs total timeout confusion

- **Issue #4**: Execution mode validation and documentation
  - Enhanced execution_mode parameter documentation with detailed behavior descriptions
  - Improved schema validation error messages for invalid execution modes
  - Added comprehensive usage examples for each execution mode

### Added
- **Enhanced Adaptive Mode**:
  - `transition_reason` property in execution results (`foreground_timeout` | `output_size_limit`)
  - Intelligent background transition when output size limit is reached
  - Partial output capture and return during transitions
  - Improved efficiency by avoiding unnecessary waits after output truncation

### Changed
- **Adaptive Mode Behavior**:
  - Now uses single process instance with intelligent foreground/background transition
  - Eliminates duplicate command execution during mode transitions
  - More predictable and efficient resource usage
  - Better user experience with clear transition reasons

## [2.1.1] - 2025-07-14

### Added
- Comprehensive MCP tool description improvements for better LLM comprehension
- Consistent naming conventions across all 18 tools
- Enhanced parameter descriptions with examples, constraints, and relationships
- Tool description best practices documentation (`docs/mcp-tool-description-best-practices.md`)
- New tool: `shell_set_default_workdir` for working directory management

### Changed
- **Tool Naming Improvements** for consistency:
  - `shell_get_execution` → `process_get_execution`
  - `process_kill` → `process_terminate`
  - `terminal_get` → `terminal_get_info`
  - `terminal_input` → `terminal_send_input`
  - `terminal_output` → `terminal_get_output`
  - `file_list` → `list_execution_outputs`
  - `file_read` → `read_execution_output`
  - `file_delete` → `delete_execution_outputs`

- **ExecutionMode Improvements**:
  - `'sync' | 'async' | 'background'` → `'foreground' | 'background' | 'detached' | 'adaptive'`
  - Default mode changed to `'adaptive'` for optimal performance
  - Added `foreground_timeout_seconds` parameter for adaptive mode
  - Added `return_partial_on_timeout` parameter for timeout handling

- **File Management Terminology**:
  - `file_id` → `output_id` for consistency
  - `file_type` → `output_type` for clarity
  - Unified "output files" terminology throughout

- **Tool Descriptions**: All 18 tools updated with:
  - Clear, specific descriptions for better LLM understanding
  - Consistent terminology and tone
  - Enhanced parameter descriptions with examples and constraints
  - Proper edge case and error condition documentation

### Fixed
- **Critical Bug**: `return_partial_on_timeout` now correctly returns partial output instead of errors
- ProcessManager and FileManager integration for proper output file management
- Timeout handling in adaptive execution mode

### Documentation
- Updated README.md with new tool names and execution modes
- Added comprehensive MCP tool description best practices guide
- Updated API examples and usage instructions
- Enhanced security and configuration documentation
- Updated implementation checklist with progress tracking

## [2.1.0] - 2025-06-17

### Added
- **Control Code Support**: Terminal input now supports control codes and escape sequences
  - `control_codes` parameter for interpreting escape sequences (`\n`, `\r`, `^C`, `\x1b`, etc.)
  - `raw_bytes` parameter for sending hexadecimal byte sequences
  - Support for Ctrl+key combinations, ANSI escape sequences, and special characters
- **Program Guard Feature**: Advanced security mechanism for terminal input protection
  - `send_to` parameter for restricting input to specific processes
  - Support for process name, full path, PID, and session leader targeting
  - Real-time foreground process detection and validation
- **Enhanced Process Information**: Extended terminal and process management
  - Foreground process information in terminal objects
  - `include_foreground_process` parameter in terminal_output
  - System process information with session leader detection
  - Process information caching for improved performance

### Enhanced
- Terminal input validation with program guard checks
- Process information retrieval with `/proc` filesystem integration
- Error handling for process detection failures
- Performance optimization with smart caching mechanisms
- Extended API responses with guard check results

### Security
- Secure process targeting prevents unintended input delivery
- Foreground process validation before input transmission
- Safe fallback behavior when process information is unavailable
- Protection against unauthorized process manipulation

### Documentation
- Complete control codes usage guide (`docs/control-codes.md`)
- Program guard feature documentation (`docs/program-guard.md`)
- Example scripts for both features
- Comprehensive API parameter documentation

## [2.0.0] - 2025-06-13

### Added
- Complete MCP Shell Server implementation with 16 tools
- Comprehensive security framework with command validation
- Process management with real-time monitoring
- Interactive terminal sessions with PTY support
- File operations with secure storage and retrieval
- System monitoring and performance metrics
- TypeScript strict mode compliance
- Comprehensive error handling with categorized error codes
- Zod schema validation for all inputs
- Background process execution support
- Terminal session management with multiple shell support
- Resource usage limits and enforcement
- Audit logging for security operations
- Dangerous pattern detection in commands
- Path restriction and access control

### Security
- Command execution sandboxing
- Configurable security restrictions
- Input validation and sanitization
- Resource limit enforcement
- Audit trail for all operations

### Technical
- Modern TypeScript with strict type checking
- Model Context Protocol SDK integration
- Modular architecture with separation of concerns
- Comprehensive test suite with Vitest
- ESLint and Prettier configuration
- GitHub Actions CI/CD pipeline

### Documentation
- Complete API specification
- Security guidelines and best practices
- Contributing guidelines
- Architecture documentation
- Usage examples and configuration guide

## [1.0.0] - Initial Release (Conceptual)

### Added
- Basic project structure
- Initial MCP SDK integration
- Simple shell command execution
- Basic security validation

---

## Planned

### [2.1.0] - Future Release
- Enhanced Windows support
- Plugin system for custom tools
- Web-based management interface
- Enhanced monitoring dashboards

### [2.2.0] - Future Release
- Distributed execution support
- Container integration
- Enhanced terminal features
- Performance optimizations
