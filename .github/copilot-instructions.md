# Copilot Instructions

## Development Rules (開発ルール)

- Do not use `console.log(...)` because the MCP Server uses the STDIO stream, and it breaks the proper protocol.
- Do not implement error recovery mechanisms that compromise security.
- Comply with Fail Fast principles.
- Ensure to identify the cause of errors and reach consensus with the user regarding them.
- Confirm requirements before making changes when the intent is unclear.

### Development Cycle (Fine-Grained Development)
- **Granular Development Cycle**: MUST commit after completing each function or paragraph
- **Quality Checks**: Execute the following before each commit:
  1. ESLint syntax check (`npm run lint`)
  2. jscpd duplicate code check (`npm run check-duplicates`) 
  3. TypeScript compilation check (`npm run build`)
- **Commit Messages**: MUST be in English with clear feature descriptions
- **Error Handling**: If quality checks fail, fix issues before re-checking

### Quality Assurance Pipeline
```bash
# Standard check sequence after development completion
npm run lint
npm run check-duplicates  
npm run build
git add .
git commit -m "feat: [specific feature description]"
```

### Development Flow Example
1. Implement new feature → Quality check → Commit
2. Implement next feature → Quality check → Commit
3. Fix bug → Quality check → Commit
4. Refactor code → Quality check → Commit

