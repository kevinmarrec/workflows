# Filesize Diff Action

A GitHub Action that analyzes file size differences between your branch and the main branch, and comments on pull requests with the changes.

## What This Action Does

1. **Restores cached file sizes** from the main branch (if available) for comparison
2. **Analyzes file sizes** in the specified directories (typically build output directories)
3. **Compares current branch file sizes** with main branch file sizes to detect changes
4. **Generates markdown tables** showing file size differences (additions, deletions, increases, decreases)
5. **Writes results to GitHub Actions step summary**
6. **Comments on pull requests** with file size changes (if enabled and changes detected)
7. **Saves cache** for future comparisons (only on main branch to establish baseline)

## Usage

**Important:** Build your projects before running this action, as it analyzes file sizes in the specified directories (typically build output directories like `dist`).

```yaml
- name: Build project
  run: npm run build

- name: Analyze file size differences
  uses: kevinmarrec/workflows/filesize-diff@main
  with:
    directories: app/dist,api/dist
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
- `comment-on-pr` (optional): Whether to comment on PRs with file size changes. Default: `true`
- `github-token` (optional): GitHub token for API calls. Defaults to `${{ github.token }}` which respects the job's permissions

**Note:** If `comment-on-pr` is enabled (default), ensure your workflow job has `pull-requests: write` permission. See [Job Permissions](#job-permissions) above.

## Outputs

- `has-changes`: Whether any file size changes were detected compared to main branch
