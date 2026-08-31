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

## Initial document graph

`Depends on` lists direct upstream Cause links. Transitive dependencies are
committed through the resulting Merkle DAG.

| Document REF | Depends on |
| --- | --- |
| `docs/document-provenance.md` | root |
| `docs/specification.md` | root |
| `SECURITY.md` | root |
| `docs/control-codes.md` | `docs/specification.md` |
| `docs/program-guard.md` | `docs/specification.md`, `SECURITY.md` |
| `docs/setup/claude-desktop.md` | `docs/specification.md`, `SECURITY.md` |
| `docs/setup/vscode.md` | `docs/specification.md`, `SECURITY.md` |
| `README.md` | all documents above |

The public README is intentionally downstream of the security policy, API
specification, feature guides, and copyable setup guides. Advancing any of
those upstream REFs makes the existing README Seal stale until it is reviewed
against the new exact generations and resealed.

## Updating one document

After editing a document, refresh only that REF and inspect the candidate before
sealing it:

```bash
sealgraph add SECURITY.md --content-file SECURITY.md --root
sealgraph candidate show SECURITY.md
sealgraph candidate compare SECURITY.md
sealgraph seal SECURITY.md
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
sealgraph fsck
sealgraph status
sealgraph stale --scan
sealgraph graph
git status --short
```

Canonical graph files must be committed together with the corresponding
document changes. Runtime-only paths must remain ignored and untracked.
