# Filesize Diff Action

A GitHub Action that analyzes file size differences against a baseline branch, and comments on pull requests with the changes.

The baseline is the branch a pull request **targets**, or the repository's **default branch** outside a pull request — whatever it is called. Every run on that branch publishes its own sizes for later runs to compare against.

## What This Action Does

1. **Restores the baseline sizes** of the branch being compared against, if a run has published them
2. **Analyzes file sizes** in the specified directories (typically build output directories)
3. **Compares them against the baseline** to detect changes
4. **Generates markdown tables** showing file size differences (additions, deletions, increases, decreases)
5. **Writes results to GitHub Actions step summary**
6. **Comments on pull requests** with file size changes (if enabled and changes detected)
7. **Publishes its own sizes** as the baseline, on runs of the baseline branch only

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

- `directories` (required): Comma-separated list of directories to analyze (e.g., `api/dist,app/dist`) (relative to workspace root)
- `ignore` (optional): Comma-separated glob patterns to leave out, matched relative to each directory (e.g. `**/*.map`). Default: none
- `cache-path` (optional): Path to cache directory. Default: `.github/cache/build-stats`
- `cache-key` (optional): Cache key prefix; the baseline branch and commit are appended to it, so do not name a branch here. Default: `build-stats`
- `comment-on-pr` (optional): Whether to comment on PRs with file size changes. Default: `true`
- `github-token` (optional): GitHub token for API calls. Defaults to `github.token`

**Note:** If `comment-on-pr` is enabled (default), ensure your workflow job has `pull-requests: write` permission. See [Job Permissions](#job-permissions) above.

## Outputs

- `has-changes`: Whether any file size changes were detected against the baseline. Also `true` when no baseline was found, since the sizes are then unreviewed

## What the summary looks like

One table of directory totals, then a section per directory: **one row per file type**, largest
first, with the file list one click away in a `<details>`.

```markdown
| Directory    | Base (Before Merge) | Head (After Merge) |                Delta |
| :----------- | ------------------: | -----------------: | -------------------: |
| **app/dist** |       **277.55 kB** |      **280.33 kB** | +2.78 kB (+1.00%) 🔺 |

### app/dist

| Type      | Base (Before Merge) | Head (After Merge) |                Delta |
| :-------- | ------------------: | -----------------: | -------------------: |
| `js`      |            243.7 kB |           246.3 kB |  +2.6 kB (+1.07%) 🔺 |
| `css`     |            21.82 kB |              22 kB |   +180 B (+0.82%) 🔺 |
| **Total** |       **277.55 kB** |      **280.33 kB** | +2.78 kB (+1.00%) 🔺 |
```

Two things worth knowing about how rows are formed:

- **Files with no extension are their own row, under their own name.** A compiled binary shares a
  type with nothing, so bucketing it under "other" would only hide it.
- **Hashed asset names are normalized and then summed.** Three `chunk-<hash>.js` become one
  `chunk.js (×3)` row whose size is their total. Summing rather than keying is what makes the
  directory total right — and comparing an aggregate is the only comparison that survives a
  rebuild, since an individual hashed chunk has no identity from one build to the next.

When a directory holds a single type, the type table is dropped: it would restate the directory
total that the summary table above already carries.

## No baseline

The baseline lives in the Actions cache, and GitHub evicts caches left unused for 7 days. So a
repository whose baseline branch has been quiet for a week has nothing to compare against, and
neither does the first pull request opened against a fresh branch.

That case is **reported, not hidden**: the summary and the comment state which branch has no
baseline, and the table lists sizes without a comparison rather than presenting one that does not
exist. A run on the baseline branch says so too, since it publishes rather than compares.
