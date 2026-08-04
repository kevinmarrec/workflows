# kevinmarrec/workflows

Reusable GitHub Actions **workflows** and **actions**, shared across my repositories.

The two are not interchangeable, and that distinction is what this repository is organised around:

|                       | Lives in                 | Referenced by    | Replaces      |
| --------------------- | ------------------------ | ---------------- | ------------- |
| **Reusable workflow** | `.github/workflows/`     | `jobs.<id>.uses` | a whole job   |
| **Action**            | one directory per action | `steps[].uses`   | a single step |

## Reusable workflows

### `release.yml`

Versions, tags and releases a package, optionally publishing to npm.

```yaml
jobs:
  release:
    uses: kevinmarrec/workflows/.github/workflows/release.yml@<sha>
    with:
      publish: true
```

| Input              | Default         | Purpose                                                           |
| ------------------ | --------------- | ----------------------------------------------------------------- |
| `build`            | `bun run build` | Command that builds the project                                   |
| `publish`          | `false`         | Whether to publish the package                                    |
| `workflow-cleanup` | –               | Workflow whose skipped `main` runs get cleaned up (e.g. `ci.yml`) |

`ci.yml` is **this repository's own CI**, not a reusable workflow — it has no `workflow_call` trigger and cannot be referenced from elsewhere.

## Actions

Each action has its own README with full inputs and outputs.

| Action                             | Type      | Purpose                                                                       |
| ---------------------------------- | --------- | ----------------------------------------------------------------------------- |
| [`setup-bun`](./setup-bun)         | composite | Set up Bun and Node.js, and install dependencies                              |
| [`filesize-diff`](./filesize-diff) | Node 24   | Compare file sizes against `main` and comment the difference on the PR        |
| [`gitops-render`](./gitops-render) | Node 24   | Render the Helm charts of Argo CD `Application`s and diff them against a base |

```yaml
steps:
  - uses: kevinmarrec/workflows/setup-bun@<sha>
```

## Pinning

Reference everything by **full commit SHA**, with the branch as a trailing comment:

```yaml
- uses: kevinmarrec/workflows/setup-bun@042e9c8deab3bdfda1fbc4a3afb283d65e69c5e5 # main
```

Tags and branches can be moved; a SHA cannot. Renovate keeps these current in consuming repositories.

## Development

```bash
bun install
bun run check   # lint, knip, typecheck
bun test        # vitest, with integration tests that run real binaries
```

The Node actions are bundled with `bun build` and their `dist/` is committed, so a consumer needs no install step. `bun run check:artifacts` rebuilds and fails if the committed bundle differs from its source — run it before pushing, or let the pre-commit hook do it.
