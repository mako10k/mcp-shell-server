# Copilot Instructions

## Development Rules (開発ルール)

- Do not use `console.log(...)` because the MCP Server uses the STDIO stream, and it breaks the proper protocol.
- Do not implement error recovery mechanisms that compromise security.
- Comply with Fail Fast principles.
- Ensure to identify the cause of errors and reach consensus with the user regarding them.
- Confirm requirements before making changes when the intent is unclear.

## Repository Layout (現状の構成)

- Root repo: orchestration, docs, and shared scripts.
- Submodules:
  - packages/shell-server (daemon/runtime library)
  - packages/mcp-shell (MCP server CLI)
  - packages/code-shell-extension (VS Code extension)
- When you edit files inside a submodule, treat that submodule as the source repo for builds, checks, and commits.
- When you edit files in the root repo, run the root repo checks and commit there.

### Development Cycle (Fine-Grained Development)
- **Granular Development Cycle**: MUST commit after completing each logical unit of work
- **Quality Checks**: Execute the following before each commit (in the repo or submodule you changed):
  1. ESLint syntax check (`npm run lint`)
  2. jscpd duplicate code check (`npm run check-duplicates`)
  3. TypeScript compilation check (`npm run build`)
- **Commit Messages**: MUST be in English with clear feature descriptions
- **Error Handling**: If quality checks fail, fix issues before re-checking

### Quality Assurance Pipeline
```bash
# Standard check sequence after development completion (run inside the repo/submodule you changed)
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

