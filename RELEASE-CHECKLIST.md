# MCP Shell Server Release Checklist

This checklist is version-agnostic. Update sections as needed per release.

## Pre-release

- Update version numbers:
  - package.json (server)
  - packages/code-shell-extension/vscode-mcp-shell/package.json (if VSIX changes are released)
- Update CHANGELOG.md with release notes
- Ensure dist is up to date: `npm run build`
- Run quality checks:
  - `npm run lint`
  - `npm run check-duplicates`
  - `npm run build`

## Tagging and npm publish

- Create the tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
- Push changes and tag:
  - `git push origin <branch>`
  - `git push origin vX.Y.Z`
- Publish to npm (2FA required):
  - `npm publish --otp <CODE>`

## VSIX packaging

- From packages/code-shell-extension/vscode-mcp-shell:
  - `npm install`
  - `npm run package:release`
- Verify package contents:
  - `npx -y @vscode/vsce ls --tree`
- If you need dev dependencies again:
  - `npm install`

## Release artifacts

- Create GitHub release from tag vX.Y.Z
- Use CHANGELOG.md content or a RELEASE-vX.Y.Z.md file for notes
- Attach VSIX if applicable

## Post-release

- Verify the published npm package
- Smoke test the VSIX in VS Code
- Announce the release
