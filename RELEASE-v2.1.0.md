# MCP Shell Server v2.1.0 Release Notes

## 🎉 New Features

### Control Code Support
Terminal input now supports comprehensive control code and escape sequence handling:

- **Control Codes Parameter**: New `control_codes` boolean parameter for `terminal_input`
- **Raw Bytes Mode**: New `raw_bytes` parameter for sending hexadecimal byte sequences
- **Escape Sequence Support**: 
  - Ctrl+key combinations (`^C`, `^D`, `^Z`)
  - ANSI escape sequences (`\x1b[31m` for colors)
  - Common escape characters (`\n`, `\r`, `\t`)
  - Unicode sequences (`\u001b`)

### Program Guard Security Feature
Advanced security mechanism for protecting against unintended input delivery:

- **Process Targeting**: New `send_to` parameter for `terminal_input`
- **Multiple Target Types**:
  - Process name: `"bash"`
  - Full path: `"/bin/bash"`
  - Process ID: `"pid:12345"`
  - Session leader: `"sessionleader:"`
  - Unrestricted: `"*"`
- **Foreground Process Detection**: Real-time detection of terminal foreground processes
- **Security Validation**: Prevents input from reaching unintended processes

### Enhanced API Responses
Extended information in API responses:

- **Program Guard Results**: `terminal_input` responses include guard check status
- **Foreground Process Info**: New `include_foreground_process` parameter for `terminal_output`
- **Process Information**: Complete process details including PID, name, path, and session info

## 🛡️ Security Improvements

### Process Information System
- Real-time foreground process detection using `/proc` filesystem
- Session leader identification for shell-level security
- Process information caching for performance optimization
- Safe fallback behavior when process information is unavailable

### Enhanced Input Validation
- Program guard prevents delivery to unexpected processes
- Control code validation ensures safe terminal operations
- Comprehensive error handling for security failures

## 📚 Documentation

### New Documentation
- **Control Codes Guide** (`docs/control-codes.md`): Complete guide to terminal control sequences
- **Program Guard Manual** (`docs/program-guard.md`): Security features and process targeting
- **Example Scripts**: Demonstration scripts for both new features

### Updated Documentation
- README.md with new feature highlights
- API specification updates
- Enhanced usage examples

## 🔧 Technical Details

### Performance Optimizations
- Process information caching (1-second TTL)
- Foreground process caching (5-second TTL)
- Asynchronous process information updates
- Efficient `/proc` filesystem access

### Platform Support
- Linux: Full support with `/proc` filesystem integration
- macOS: Compatible (limited process information)
- Windows: Basic compatibility

## 🚀 Upgrade Guide

### For Existing Users
1. Update to v2.1.0: `npm update mcp-shell-server`
2. Review new security features in program guard documentation
3. Optional: Implement program guard for enhanced security
4. Optional: Use control codes for advanced terminal interactions

### API Changes
- **Backward Compatible**: All existing functionality remains unchanged
- **New Parameters**: `control_codes`, `raw_bytes`, `send_to` are optional
- **Extended Responses**: Additional fields in responses (non-breaking)

### Migration Notes
- No breaking changes - existing code continues to work
- New features are opt-in through additional parameters
- Enhanced security is available but not enforced by default

## 🔗 Links

- [GitHub Repository](https://github.com/mako10k/mcp-shell-server)
- [Control Codes Documentation](docs/control-codes.md)
- [Program Guard Documentation](docs/program-guard.md)
- [API Specification](docs/specification.md)

## 🙏 Acknowledgments

This release focuses on security and terminal control, making MCP Shell Server more powerful and secure for production use. The program guard feature provides enterprise-grade security for terminal interactions, while control code support enables advanced terminal automation scenarios.

---

**Full Changelog**: [v2.0.0...v2.1.0](https://github.com/mako10k/mcp-shell-server/compare/v2.0.0...v2.1.0)
