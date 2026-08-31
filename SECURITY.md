# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | :white_check_mark: |
| < 2.0   | :x:                |

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

### Security Features

This project includes several security features:

- **Restrictive Sandbox**: Restrictive local non-interactive commands run through a required Bubblewrap profile with a read-only workspace, private temporary storage, fixed environment, and no IP network
- **Canonical Path Validation**: Existing request paths use real-path and component-boundary checks; path validation alone is not filesystem confinement
- **Fail-closed Routes**: Restrictive terminal, remote, detached, environment-override, and provider-failure paths stop before the requested command starts
- **Resource Limits**: Execution-time and host-memory output-retention limits are enforced; complete cgroup-backed CPU and memory containment is not currently provided
- **Audit Logging**: All operations are logged for security auditing
- **Explicit Receipts**: Successful executions identify whether they used the direct host launcher or the restrictive Bubblewrap profile

### Security Best Practices

When using this server:

1. Always run with minimal required permissions
2. Regularly update to the latest version
3. Configure appropriate security restrictions
4. Monitor audit logs for suspicious activity
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
- Process monitoring requires appropriate system permissions
