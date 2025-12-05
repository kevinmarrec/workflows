# Project Build Stats Action

A GitHub Action that analyzes project build stats and comments on pull requests with stats changes.

## What This Action Does

1. **Restores cached build stats** from the main branch (if available) for comparison
2. **Builds each specified directory** using the configured package manager
3. **Analyzes build output** by collecting file sizes from the `dist` directory
4. **Compares current stats with cached stats** to detect changes
5. **Generates markdown tables** showing file size differences
6. **Writes results to GitHub Actions step summary**
7. **Comments on pull requests** with build stats changes (if enabled and changes detected)
8. **Saves cache** for future comparisons (only on main branch)

## Usage

```yaml
- name: Analyze project build stats
  uses: kevinmarrec/workflows/project-build-stats@main
  with:
    directories: app,api
```

### Job Permissions

If you want the action to comment on pull requests (enabled by default), you need to grant write permissions to the job:

```yaml
permissions:
  contents: read
  pull-requests: write
```

## Inputs

- `directories` (required): Comma-separated list of directories to analyze (relative to workspace root)
- `package-manager` (optional): Package manager to use (bun, pnpm, yarn, npm). Default: `bun`
- `cache-path` (optional): Path to cache directory. Default: `.github/cache/build-stats`
- `cache-key` (optional): Cache key to use for restore/save. Default: `build-stats-main`
- `show-total` (optional): Show total row in the table. Default: `true`
- `comment-on-pr` (optional): Whether to comment on PRs with build stats changes. Default: `true`
- `github-token` (optional): GitHub token for API calls. Defaults to `${{ github.token }}` which respects the job's permissions

**Note:** If `comment-on-pr` is enabled (default), ensure your workflow job has `pull-requests: write` permission. See [Job Permissions](#job-permissions) above.

## Outputs

- `has-changes`: Whether any build stats changes were detected
