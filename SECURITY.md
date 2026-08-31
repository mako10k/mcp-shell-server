# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.8.x   | :white_check_mark: |
| < 2.8   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. Please follow these steps to report a vulnerability:

### For Security Issues

1. **DO NOT** open a public issue for security vulnerabilities
2. Submit a private report using GitHub's [Private Vulnerability Reporting](https://github.com/mako10k/mcp-shell-server/security/advisories/new) or email [mako10k@mk10.org](mailto:mako10k@mk10.org) with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Confirmation**: Within 7 days
- **Fix Release**: Within 30 days (for critical issues)

### Execution-Boundary Controls and Disclosures

The current implementation provides the following controls and receipts:

- **Restrictive Sandbox**: Restrictive local non-interactive commands run through a required Bubblewrap profile with a read-only workspace, private temporary storage, fixed environment, and no IP network
- **Canonical Path Validation**: Existing request paths use real-path and component-boundary checks; path validation alone is not filesystem confinement
- **Fail-closed Routes**: Restrictive terminal, remote, detached, environment-override, and provider-failure paths stop before the requested command starts
- **Resource Limits**: Execution-time and host-memory output-retention limits are enforced; complete cgroup-backed CPU and memory containment is not currently provided
- **Operational Records**: After `shell_execute` obtains an initial execution result, it attempts to add command metadata to command history. Selected lifecycle and error events are also logged. These records are not a complete or tamper-evident audit trail of every MCP tool call
- **Explicit Receipts**: Successful executions identify whether they used the direct host launcher or the restrictive Bubblewrap profile

### Security Best Practices

When using this server:

1. Always run with minimal required permissions
2. Regularly update to the latest version
3. Configure appropriate security restrictions
4. Monitor the available command history and operational logs, accounting for their coverage limits
5. Use network restrictions when possible

### Known Security Considerations

- This server executes shell commands - ensure proper access controls
- Permissive, moderate, enhanced, and enhanced-fast execution is not OS-confined
- Legacy custom command lists are migration-only and cannot execute
- Restrictive mode requires Linux and a successfully probed Bubblewrap installation
- Restrictive startup rejects workspaces containing observed sockets, FIFOs, devices, or unknown special entries. Concurrent host mutation after inspection, nested mounts, and FUSE behavior remain outside this local-operator threat model; do not place sensitive endpoints under approved roots
- Every readable regular file below the selected approved root remains readable in restrictive mode; configure narrow project roots rather than home directories or trees containing credentials
- Bubblewrap and its host installation path are trusted operator-managed dependencies; deliberate host-side replacement or concurrent mount-tree mutation is outside this local-user threat model
- Terminal sessions can persist in unconfined modes - implement session timeouts
- File-operation path checks do not constrain arbitrary effects of an unconfined child process
- Program Guard foreground-process discovery currently depends on Linux `/proc` data and is a point-in-time application check, not an isolation boundary
