# Release v2.4.0

**Release Date**: August 8, 2025

## 🎯 **Major Features**

### ✨ **Structured Output Security Evaluation**
- **Type-Safe LLM Responses**: Zod schema validation for all security evaluations
- **Multi-Stage Evaluation**: UserIntentReevaluation and AdditionalContextReevaluation schemas
- **Enhanced Confidence Scoring**: Improved accuracy in security decision confidence

### 🏗️ **mcp-llm-generator Integration**
- **Function Call Emulation**: Advanced patterns for complex security workflows
- **ResponseParser Architecture**: Extensible base classes for structured AI interactions
- **Tool Call Emulation**: Standardized schema patterns for consistent LLM interactions

## 🔧 **Architecture Improvements**

### 📉 **Massive Code Reduction**
- **380+ → 110 lines**: SecurityResponseParser drastically simplified through inheritance
- **Base Class Framework**: BaseResponseParser and CommonLLMEvaluator for shared logic
- **Inheritance Hierarchy**: Clean separation of concerns with specialized implementations

### 🛡️ **Enhanced Security Evaluator**
- **LLM-Centric Design**: Simplified approach extending CommonLLMEvaluator
- **Structured Output Integration**: Type-safe parsing with fallback mechanisms
- **Improved Error Handling**: Better resilience and debugging capabilities

## 🔬 **Technical Enhancements**

### **Zod Schema Validation**
```typescript
// New type-safe security evaluation schemas
SecurityEvaluationResultSchema
UserIntentReevaluationSchema  
AdditionalContextReevaluationSchema
```

### **Response Parser Framework**
```typescript
// Extensible base classes
BaseResponseParser     // Common parsing logic
CommonLLMEvaluator     // Shared LLM evaluation patterns
SecurityResponseParser // Security-specific implementation
```

### **Confidence Scoring**
- Enhanced parsing confidence algorithms
- JSON extraction reliability improvements
- Validation error handling with graceful degradation

## 📦 **Installation & Usage**

```bash
npm install @mako10k/mcp-shell-server@2.4.0
```

### **VS Code MCP Configuration**
```json
{
  "servers": {
    "mcp-shell-server": {
      "type": "stdio",
      "command": "npm",
      "args": ["start"],
      "cwd": "${workspaceFolder}",
      "env": {
        "MCP_SHELL_SECURITY_MODE": "enhanced",
        "MCP_SHELL_ELICITATION": "true"
      }
    }
  }
}
```

## 🔄 **Migration Notes**

### **Backward Compatibility**
- ✅ All existing environment variables maintained
- ✅ API compatibility preserved
- ✅ Configuration files remain unchanged

### **Enhanced Features**
- 🆕 Structured output evaluation automatically enabled
- 🆕 Improved confidence scoring in security decisions
- 🆕 Better error messages and debugging information

## 🧪 **Quality Assurance**

### **Code Quality Metrics**
- ✅ ESLint: All checks passed
- ✅ TypeScript: Compilation successful
- ⚠️ jscpd: Minor duplications remain (non-blocking)
- ✅ Build: All targets successful

### **Testing Coverage**
- Enhanced security evaluator tests updated
- Structured output parsing validation
- Integration tests for new base classes

## 📈 **Performance**

### **Memory Efficiency**
- Reduced code footprint through inheritance
- Optimized parsing logic with shared components
- Better garbage collection patterns

### **Evaluation Speed**
- Faster structured output parsing
- Reduced redundant validation logic
- Streamlined LLM evaluation pipeline

## 🎉 **Highlights**

1. **70% Code Reduction** in SecurityResponseParser through smart inheritance
2. **Type Safety** for all LLM interactions with Zod validation
3. **Extensible Architecture** for future security evaluation enhancements
4. **mcp-llm-generator Integration** brings advanced AI interaction patterns
5. **Backward Compatible** ensuring seamless upgrades

---

## 📋 **Full Changelog**

See [CHANGELOG.md](./CHANGELOG.md) for detailed changes.

## 🐛 **Known Issues**

- Minor code duplications detected by jscpd (non-functional impact)
- Some legacy pattern matching code remains for backward compatibility

## 📞 **Support**

- **Issues**: [GitHub Issues](https://github.com/mako10k/mcp-shell-server/issues)
- **Documentation**: [README.md](./README.md)
- **Examples**: [examples/](./examples/)
