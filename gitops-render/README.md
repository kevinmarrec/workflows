# GitOps Render Action

A GitHub Action that renders the Helm charts referenced by Argo CD `Application` manifests, and diffs the result against a base commit.

It exists for repositories that hold Argo CD configuration but have no cluster in CI: rendering is the only verification `.gitops/` can get. It catches the two failures that actually happen — values that no longer satisfy a bumped chart's schema, and a chart repository that has moved.

## What This Action Does

1. **Reads every Application** matched by the `apps` glob, and extracts its chart sources
2. **Rejects Applications** using Argo CD features it does not implement, rather than rendering them wrong
3. **Renders each chart** with `helm template`, using the value files the Application actually deploys with
4. **Renders the same charts at the base commit**, in a detached worktree, so the base uses the base's values
5. **Compares the two renders**, reporting resources the chart started or stopped emitting
6. **Writes the result to the job summary**, with each render diff behind a details block

## Requirements

`helm` must be on `PATH` — this action does not install it. The base render needs full history.

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0

- uses: azure/setup-helm@v5

- uses: kevinmarrec/workflows/gitops-render@main
  with:
    base-sha: ${{ github.event.pull_request.base.sha || github.event.before }}
```

## A diff is never a failure

Changing your own values, or taking a chart bump, changes the rendered output — that is expected and the job stays green. The diff is a review aid, not a gate.

The job fails only when something genuinely cannot render:

| Situation                                        | Result                       |
| ------------------------------------------------ | ---------------------------- |
| You changed values on purpose, or a chart bumped | ✅ diff in the summary       |
| A chart's values no longer satisfy its schema    | ❌                           |
| A chart repository moved or 404s                 | ❌                           |
| An Application uses an unsupported feature       | ❌                           |
| The glob matched no chart sources at all         | ❌                           |
| The **base** commit fails to render              | ✅ reported as "no baseline" |

Every chart is attempted before the job fails, so one broken chart cannot hide a second.

## Supported sources

Within a `spec.source` or `spec.sources` entry:

| Source                                 | Handling                                                           |
| -------------------------------------- | ------------------------------------------------------------------ |
| `chart` + `repoURL` + `targetRevision` | Rendered. `helm.valueFiles` is honoured, including `$values/` refs |
| `path`                                 | Skipped — Argo CD applies these manifests directly                 |
| `ref`                                  | Skipped — it only anchors `$values/` paths                         |
| Anything else                          | **Fails the job**                                                  |

`helm.valuesObject`, `helm.parameters`, and Kustomize or plugin sources are deliberately **not** implemented. Rendering them as though they were absent would produce output that silently differs from what Argo CD deploys, so the action refuses instead. Manifests that are not `kind: Application` — `AppProject`, for instance — are skipped.

A chart source missing `repoURL` or `spec.destination.namespace` also fails, rather than reaching helm as `--repo ""` or `--namespace null` and failing somewhere further from the cause.

## Inputs

- `apps` (optional): Glob matching the Application manifests to render. Default: `.gitops/apps/*.yaml`
- `base-sha` (optional): Commit to render as the baseline. Omit it, or pass a commit that cannot be resolved, to render without a diff
- `max-diff-lines` (optional): Maximum diff lines per application in the summary. Default: `300`

## Outputs

- `has-changes`: Whether any rendered output differs from the base commit
