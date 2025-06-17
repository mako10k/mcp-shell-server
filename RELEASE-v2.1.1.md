# MCP Shell Server v2.1.1 Release Notes

## 🔧 Bug Fixes & Improvements

### Schema Consistency Fix
Fixed critical schema inconsistency where `terminal_input` tool was missing v2.1.0 parameters in the actual MCP tool schema definition:

- **Fixed**: `control_codes` parameter now properly exposed in tool schema
- **Fixed**: `raw_bytes` parameter now properly exposed in tool schema  
- **Fixed**: `send_to` parameter (program guard) now properly exposed in tool schema

This ensures all v2.1.0 control code and program guard features are actually usable by MCP clients.

### Architecture Improvements
- **Added**: `zod-to-json-schema` dependency for automatic schema generation
- **Improved**: All 16 tool schemas now generated from Zod schemas instead of manual JSON Schema definitions
- **Enhanced**: Single source of truth for schema definitions eliminates future inconsistencies

### Developer Experience
- **Added**: Comprehensive `.describe()` annotations to all Zod schema parameters
- **Improved**: Auto-generated JSON schemas now include proper parameter descriptions
- **Enhanced**: Better IDE support and type safety

### Documentation Updates
- **Updated**: `docs/specification.md` with correct `terminal_input` parameters and response format
- **Added**: Complete parameter documentation for all new v2.1.0 features

## 🚀 What's Fixed

Before this release, the following v2.1.0 features were unusable due to schema inconsistency:
- Control code sending (`^C`, `^D`, ANSI escape sequences)
- Raw byte transmission (hex string format)
- Program guard security (targeted input to specific processes)

These features are now fully functional and properly exposed to MCP clients.

## 🔄 Breaking Changes

None - this is a compatibility fix that makes existing features work as documented.

## 📦 Installation

```bash
npm install mcp-shell-server@2.1.1
```

## 🔗 Full Changelog

- Fix terminal_input schema consistency and improve Zod schema descriptions (#1)
- All tool schemas now auto-generated from Zod for consistency
- Added comprehensive parameter descriptions
- Updated documentation to match implementation

---

**For previous releases, see:**
- [v2.1.0 Release Notes](./RELEASE-v2.1.0.md)
