# Document Provenance with Sealgraph

This repository uses Sealgraph to record which exact generations of upstream
documents were reviewed when a downstream document was sealed. The canonical
graph is stored under `.sealgraph/` and is committed with the repository.

A Seal records content identity and exact dependency generations. It does not
by itself assert that the content is correct, approved, secure, or current.
Review and acceptance remain explicit human decisions.

## Repository boundary

The initial graph uses the format-4 repository written by Sealgraph
`0.1.0-beta.6`.

Track these canonical paths:

- `.sealgraph/config`
- `.sealgraph/objects/**`
- `.sealgraph/refs/seals/**/.ref`

Do not track runtime-only state:

- `.sealgraph/index/`
- `.sealgraph/cache/`
- `.sealgraph/locks/`
- `.sealgraph/logs/`

Source bindings are machine-local conveniences under `.sealgraph/index/`; they
are not canonical provenance. The workflow below therefore uses explicit
`--content-file` inputs.

After a fresh checkout, canonical graph files are present but the ignored empty
runtime directories are not. Run `sealgraph init` once in the checkout to
recreate `index` and `locks` before inspection. On an existing valid format-4
repository this does not replace the canonical graph.

## Current document graph

`Depends on` lists direct upstream Cause links. Transitive dependencies are
committed through the resulting Merkle DAG.

| Document REF | Depends on |
| --- | --- |
| `package.json`, `CHANGELOG.md`, `docs/document-provenance.md` | root |
| `src/index.ts`, `src/server.ts`, `src/types/schemas.ts`, `src/types/quick-schemas.ts` | root |
| `src/security/manager.ts`, `src/tools/shell-tools.ts` | root |
| `src/core/process-manager.ts`, `src/core/terminal-manager.ts` | root |
| `src/core/enhanced-history-manager.ts`, `src/utils/helpers.ts` | root |
| `extensions/vscode-mcp-shell/package.json` | `package.json`, server and schema roots |
| `extensions/vscode-mcp-shell/src/extension.ts` | `package.json`, `src/server.ts`, extension package metadata |
| `docs/specification.md` | package, CLI, server, schema, policy, handler, process, terminal, history, and logger roots |
| `SECURITY.md` | `package.json`, policy, handler, process, terminal, and logger roots |
| `docs/control-codes.md` | specification, quick schema, terminal manager |
| `docs/program-guard.md` | specification, security policy, quick schema, terminal manager |
| each setup guide | `package.json`, specification, security policy |
| `CONTRIBUTING.md` | `package.json` |
| `GITHUB_SETUP.md` | `package.json`, security policy, changelog, contributing guide |
| each JSON client example | matching setup guide, security policy |
| each JavaScript terminal demo | matching terminal guide, quick schema |
| `docs/README.md` | all current and maintainer documents above, plus changelog |
| `README.md` | `package.json`, extension package metadata, documentation map, all packaged examples |

The specification is intentionally downstream of the implementation files that
define the registered tools, schemas, execution boundaries, terminal behavior,
history, and logging. The public README is downstream of the resulting current
documentation set and packaged examples. Advancing an upstream REF makes each
affected downstream Seal stale until it is reviewed against the new exact
generation and resealed.

## Updating one document

After editing an authoritative source, refresh only that REF and inspect the
candidate before sealing it:

```bash
sealgraph add src/security/manager.ts \
  --content-file src/security/manager.ts \
  --root
sealgraph candidate show src/security/manager.ts
sealgraph candidate compare src/security/manager.ts
sealgraph seal src/security/manager.ts
```

For a dependent document, provide the complete intended dependency set. Bare
REF selectors resolve the current HEAD at command execution time:

```bash
sealgraph add docs/program-guard.md \
  --content-file docs/program-guard.md \
  --depend-on docs/specification.md \
  --depend-on SECURITY.md
sealgraph candidate show docs/program-guard.md
sealgraph candidate compare docs/program-guard.md
sealgraph seal docs/program-guard.md
```

After advancing an upstream document, review affected documents upstream-first:

```bash
sealgraph stale --frontier
sealgraph impact SECURITY.md
sealgraph status README.md
```

There is intentionally no recursive reseal or automatic approval. Each stale
document must be reviewed, refreshed with its full intended dependency set, and
sealed separately.

## Validation

Before committing graph changes, run:

```bash
sealgraph init
npm run docs:check
sealgraph fsck
sealgraph status
sealgraph stale --scan
sealgraph graph
git status --short
```

Canonical graph files must be committed together with the corresponding
document changes. For every tracked REF, `sealgraph show REF --raw-content`
must byte-compare equal to its repository file. Runtime-only paths must remain
ignored and untracked.
