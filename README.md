# kevinmarrec/workflows

A collection of reusable GitHub Actions workflows and actions.

## Features

- Standardized CI/CD workflow for releasing
- Easy integration into any TypeScript repository
- Includes custom actions for setup and automation

## Included Workflows

- **Release**: Publishes releases to npm

## Usage

To use a workflow, reference it in your project’s `.github/workflows/*.yml`:

```yaml
# Example: Release
name: Release
uses: kevinmarrec/workflows/.github/workflows/release.yml@main
```

## Actions

- [`setup-bun/action.yml`](./setup-bun/action.yml): Setup Bun, Node.js and installs dependencies
- [`filesize-diff/action.yml`](./filesize-diff/action.yml): Analyze file size differences between the current branch and main branch, and comment on PRs with changes
- [`gitops-render/action.yml`](./gitops-render/action.yml): Render the Helm charts referenced by Argo CD Applications, and diff them against a base commit
