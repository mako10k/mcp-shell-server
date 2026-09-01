# GitHub Repository Metadata

This is a maintainer reference for the existing GitHub repository. It records
recommended metadata; it does not assert that the remote settings have already
been updated.

## Recommended identity

- Repository name: `mcp-shell-server`
- Product name: `MCP Shell Server`
- Description: `Model Context Protocol server for shell command execution, terminal sessions, and retained output management`
- Suggested topics: `mcp`, `model-context-protocol`, `shell`, `terminal`,
  `typescript`, `nodejs`

The description deliberately avoids a blanket isolation or sandbox claim. Runtime
isolation depends on the selected mode; see [SECURITY.md](SECURITY.md).

## Repository files

The repository includes:

- [README.md](README.md): public overview and installation
- [Documentation Map](docs/README.md): current versus historical documents
- [SECURITY.md](SECURITY.md): reporting and execution-boundary disclosures
- [CHANGELOG.md](CHANGELOG.md): release history
- [CONTRIBUTING.md](CONTRIBUTING.md): contribution workflow
- `package.json`: npm identity and scripts
- `.github/workflows/ci.yml`: CI workflow
- `.github/ISSUE_TEMPLATE/` and `.github/pull_request_template.md`: contribution templates

## Maintainer checks

Before changing GitHub metadata or creating a release:

1. Confirm the version and description in `package.json`.
2. Run `npm run docs:check`, `npm run build`, and the relevant tests.
3. Review [CHANGELOG.md](CHANGELOG.md) for the candidate version.
4. Confirm the target commit, tag, and remote state before any external write.
5. Read back the GitHub metadata or release after updating it.

Repository metadata changes, pushes, tags, and releases are separate external
actions. This document does not authorize them.
