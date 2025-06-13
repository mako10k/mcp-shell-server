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
2. Send an email to [security@your-domain.com] with:
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

- **Command Validation**: All shell commands are validated against security policies
- **Path Restrictions**: File system access is limited to allowed directories
- **Resource Limits**: CPU, memory, and execution time limits are enforced
- **Audit Logging**: All operations are logged for security auditing
- **Sandboxed Execution**: Commands run in isolated environments

### Security Best Practices

When using this server:

1. Always run with minimal required permissions
2. Regularly update to the latest version
3. Configure appropriate security restrictions
4. Monitor audit logs for suspicious activity
5. Use network restrictions when possible

### Known Security Considerations

- This server executes shell commands - ensure proper access controls
- Terminal sessions can persist - implement session timeouts
- File operations have directory restrictions - verify allowed paths
- Process monitoring requires appropriate system permissions
