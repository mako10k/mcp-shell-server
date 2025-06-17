# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
