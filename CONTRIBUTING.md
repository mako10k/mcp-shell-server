# Contributing to MCP Shell Server

Thank you for your interest in contributing to MCP Shell Server! This document provides guidelines for contributing to the project.

## Code of Conduct

By participating in this project, you agree to abide by our code of conduct. Be respectful, inclusive, and professional in all interactions.

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- npm or yarn package manager
- TypeScript knowledge
- Basic understanding of Model Context Protocol (MCP)

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/mcp-shell-server.git
   cd mcp-shell-server
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Build the project:
   ```bash
   npm run build
   ```

5. Run tests:
   ```bash
   npm test
   ```

## Development Workflow

### Branch Naming

- Feature branches: `feature/description`
- Bug fixes: `fix/description`
- Documentation: `docs/description`
- Refactoring: `refactor/description`

### Commit Messages

Follow conventional commit format:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes
- `refactor:` Code refactoring
- `test:` Test additions or changes
- `chore:` Maintenance tasks

Example: `feat: add support for PowerShell terminals`

### Code Style

- Use TypeScript strict mode
- Follow ESLint configuration
- Use Prettier for formatting
- Add JSDoc comments for public APIs
- Write comprehensive tests for new features

### Testing

- Write unit tests for new functionality
- Ensure all tests pass before submitting PR
- Include integration tests for complex features
- Test security features thoroughly

## Types of Contributions

### Bug Reports

When reporting bugs, include:
- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node.js version)
- Relevant logs or error messages

### Feature Requests

For new features:
- Describe the problem you're solving
- Explain your proposed solution
- Consider security implications
- Discuss potential breaking changes

### Code Contributions

1. **Small Changes**: Open a PR directly
2. **Large Changes**: Open an issue first to discuss

### Documentation

- API documentation
- Usage examples
- Security guidelines
- Architecture explanations

## Pull Request Process

1. **Before submitting:**
   - Run `npm run build` to ensure compilation
   - Run `npm test` to verify all tests pass
   - Run `npm run lint` to check code style
   - Update documentation if needed

2. **PR Description:**
   - Clear title and description
   - Reference related issues
   - List changes made
   - Include testing details

3. **Review Process:**
   - Maintainers will review within 48 hours
   - Address feedback promptly
   - Keep PR updated with main branch

## Architecture Guidelines

### Core Principles

- **Security First**: All operations must be secure by default
- **Type Safety**: Use TypeScript strictly
- **Modularity**: Keep components loosely coupled
- **Performance**: Consider resource usage
- **Compatibility**: Support multiple platforms

### Directory Structure

```
src/
├── core/           # Core business logic managers
├── security/       # Security and validation
├── tools/          # MCP tool implementations
├── types/          # Type definitions and schemas
├── utils/          # Shared utilities
├── server.ts       # Main MCP server
└── index.ts        # Entry point
```

### Adding New Features

1. **Design**: Consider security and performance implications
2. **Types**: Define TypeScript interfaces and Zod schemas
3. **Implementation**: Follow existing patterns
4. **Tests**: Comprehensive test coverage
5. **Documentation**: Update API docs and README

## Security Considerations

### When Contributing

- Never commit secrets or credentials
- Validate all user inputs
- Consider command injection risks
- Test with restricted environments
- Document security implications

### Security Review

Security-related changes require additional review:
- Input validation changes
- Command execution modifications
- File system operations
- Network access features

## Release Process

### Versioning

We follow Semantic Versioning (SemVer):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

### Release Notes

- Document all changes
- Highlight breaking changes
- Include migration guides
- Note security updates

## Getting Help

- **Questions**: Open a discussion
- **Issues**: Use issue templates
- **Real-time**: Join our community chat
- **Security**: Follow security policy

## Recognition

Contributors will be recognized in:
- CONTRIBUTORS.md file
- Release notes
- Project documentation

Thank you for contributing to MCP Shell Server!
