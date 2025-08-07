# Release v2.3.1 - Emergency Hotfix

**Release Date**: August 7, 2025  
**Type**: Hotfix Release  
**Priority**: CRITICAL - Immediate deployment required

## 🚨 Critical Fixes

### Enhanced Safety Evaluator - MCP Elicitation Protocol Repair
- **FIXED**: MCP elicitation request parsing error (`Cannot read properties of undefined (reading 'parse')`)
- **FIXED**: Incorrect `sendRequest` method implementation causing protocol failures
- **IMPROVED**: Simplified elicitation message format (user feedback-driven)
- **IMPROVED**: Reduced complexity in security confirmation dialogs

## Technical Details

### Issues Resolved
1. **Protocol Error**: `TypeError: Cannot read properties of undefined (reading 'parse')` in MCP SDK interaction
2. **Method Signature**: Corrected `sendRequest<T>()` type definition and usage
3. **Message Complexity**: Reduced verbose security confirmation messages to essential information

### Code Changes
- Enhanced Safety Evaluator elicitation method signatures corrected
- MCP protocol compliance restored for real user confirmation
- Simplified message format: Command display + Yes/No + Optional reason field
- 3-minute timeout maintained for user responses

## Impact Assessment

### Before Fix (v2.3.0)
❌ CONDITIONAL_DENY commands caused fatal MCP protocol errors  
❌ Elicitation system completely non-functional  
❌ Security decisions falling back to unsafe defaults  

### After Fix (v2.3.1)
✅ MCP elicitation requests properly formatted and parsed  
✅ User confirmation workflow functional  
✅ Security system properly blocks dangerous commands pending user approval  
✅ Clean error handling with actionable feedback  

## Deployment Priority

**IMMEDIATE DEPLOYMENT REQUIRED**

- Previous v2.3.0 release contained broken elicitation implementation
- Security system partially compromised in production environments
- User experience severely degraded for any CONDITIONAL_DENY commands
- Hotfix restores intended security behavior

## Testing Summary

- ✅ TypeScript compilation successful
- ✅ MCP protocol interaction corrected
- ✅ Elicitation message format validated
- ✅ Error handling improved

## Next Steps

1. **Immediate**: Deploy v2.3.1 to resolve critical elicitation failures
2. **Short-term**: Add language localization for elicitation messages
3. **Medium-term**: Enhanced user experience improvements for security confirmations

---

**Note**: This is an emergency hotfix release to restore functionality that was inadvertently broken in v2.3.0. All users should upgrade immediately.
