# Setup Bun Action

A GitHub Action that sets up Bun, Node.js, and optionally installs dependencies.

## What This Action Does

1. **Checks out the repository** using `actions/checkout`
2. **Sets up Bun** using the version specified in `package.json` (via `bun-version-file`)
3. **Sets up Node.js** with the specified version (defaults to LTS)
4. **Installs dependencies** using `bun install --frozen-lockfile` (if `auto-install` is `true`)

## Usage

```yaml
- name: Setup Bun
  uses: kevinmarrec/workflows/setup-bun@main
```

## Inputs

- `persist-credentials` (optional): Whether to configure the token or SSH key with the local git config. Default: `false`
- `fetch-all` (optional): Whether to fetch all history for all branches and tags. Default: `false`
- `node-version` (optional): Version spec of Node.js to use. Examples: `12.x`, `10.15.1`, `>=10.15.0`. Default: `lts/*`
- `auto-install` (optional): Whether to automatically install dependencies using `bun install --frozen-lockfile`. Default: `true`
