# Documentation Map

Use this index to distinguish current user documentation from design and
historical material. The source code and generated MCP tool schemas remain the
authority for the executable interface.

## Current user documentation

- [README](../README.md): installation, configuration, and public tool overview
- [Security Policy](../SECURITY.md): supported versions, reporting, and execution-boundary limits
- [API Specification](specification.md): current public MCP tool surface
- [Claude Desktop Setup](setup/claude-desktop.md)
- [VS Code Setup](setup/vscode.md)
- [Control Codes](control-codes.md): control-code input through `terminal_operate`
- [Program Guard](program-guard.md): guarded terminal input through `terminal_operate`
- [Document Provenance](document-provenance.md): Sealgraph dependency workflow
- [Changelog](../CHANGELOG.md)

## Repository maintainer documentation

- [Contributing](../CONTRIBUTING.md): development and pull-request checks
- [GitHub Repository Metadata](../GITHUB_SETUP.md): recommended public identity and maintainer readback checklist

## Design and historical material

The remaining files under `docs/` are design notes, discussions, requirements,
or implementation plans. They provide project history and may describe older
tool names or superseded behavior. They are not the current public API contract
and are excluded from the npm package.

When one of these documents becomes normative again, update it against the
current source, add an explicit status, and include it in the Sealgraph graph.
