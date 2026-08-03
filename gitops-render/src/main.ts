import { type ChartSource, chartSources, UnsupportedSourceError } from './application'
import { compareManifests } from './compare'
import type { RenderResult } from './helm'
import { type AppOutcome, type AppResult, countFailed, renderSummary } from './summary'

export interface Deps {
  /** Both trees are listed and read the same way, so the base is parsed from its own manifests. */
  listApps: (glob: string, root: string) => Promise<string[]>
  readApp: (root: string, file: string) => Promise<string>
  /** `tree` says which of the two renders this is, so the caller can label it without reading `root`. */
  render: (source: ChartSource, root: string, tree: 'head' | 'base') => Promise<RenderResult>
  materializeBase: (sha: string) => Promise<string | null>
  cleanupBase: (root: string) => Promise<void>
}

export interface RunInput {
  apps: string
  baseSha?: string
  maxDiffLines: number
}

interface RunOutput {
  results: AppResult[]
  summary: string
  hasChanges: boolean
  annotations: { file: string, message: string }[]
  failures: string[]
}

/** A chart source, its counterpart in the base tree, and what each tree made of it. */
interface Render {
  source: ChartSource
  baseSource?: ChartSource
  head: RenderResult
  base?: RenderResult
}

/**
 * Pairs a chart across the two trees. The Application's name alone would collide between the
 * chart legs of a multi-source Application, and the chart's name alone would collide between two
 * Applications deploying the same chart.
 */
function sourceKey(source: ChartSource): string {
  return `${source.app}/${source.chart}`
}

function outcomeFor({ source, head, base }: Render, maxDiffLines: number): AppOutcome {
  if (!head.ok) return { status: 'failed', stderr: head.stderr }

  // A base that is absent, unreadable, or broken is a missing baseline — never a change.
  if (!base) return { status: 'no-baseline', reason: 'missing' }
  if (!base.ok) return { status: 'no-baseline', reason: 'render-failed' }

  return compareManifests(source.app, base.manifests, head.manifests, maxDiffLines)
}

/** `argo-cd 9.5.17 → 10.2.2` when the pin moved, so the summary names the bump under review. */
function versionLabel({ source, baseSource }: Render): string {
  const bumpedFrom = baseSource && baseSource.revision !== source.revision ? `${baseSource.revision} → ` : ''

  return `${source.chart} ${bumpedFrom}${source.revision}`
}

/**
 * Extracts the chart sources of one tree, collecting the guard failures rather than throwing on
 * the first, so every unsupported Application is reported in one run.
 */
async function collectSources(root: string, input: RunInput, deps: Deps) {
  const sources: ChartSource[] = []
  const errors: UnsupportedSourceError[] = []

  for (const file of await deps.listApps(input.apps, root)) {
    try {
      sources.push(...chartSources(await deps.readApp(root, file), file))
    }
    catch (error) {
      if (!(error instanceof UnsupportedSourceError)) throw error

      errors.push(error)
    }
  }

  return { sources, errors }
}

export async function main(input: RunInput, deps: Deps): Promise<RunOutput> {
  const annotations: RunOutput['annotations'] = []
  const failures: string[] = []

  const { sources, errors } = await collectSources('.', input, deps)

  for (const error of errors) {
    annotations.push({ file: error.file, message: error.message })
    failures.push(`${error.file}: ${error.message}`)
  }

  const baseRoot = input.baseSha ? await deps.materializeBase(input.baseSha) : null
  const renders: Render[] = []

  try {
    // The base tree is parsed from its own manifests, so a chart bump renders the version each
    // commit actually pinned. Its guard failures are discarded: the base may predate a guard, or
    // use a feature this very commit removes, and neither is this commit's problem.
    const baseSources = baseRoot ? (await collectSources(baseRoot, input, deps)).sources : []
    const baseByKey = new Map(baseSources.map(source => [sourceKey(source), source]))

    // Every head render is attempted first, so one broken chart cannot hide a second.
    for (const source of sources) {
      const head = await deps.render(source, '.', 'head')
      renders.push({ source, baseSource: baseByKey.get(sourceKey(source)), head })

      if (!head.ok) {
        annotations.push({ file: source.file, message: `${source.chart} ${source.revision} failed to render\n${head.stderr}` })
      }
    }

    if (baseRoot) {
      for (const render of renders) {
        // A chart the base tree never declared is new, and has no baseline rather than a diff.
        if (render.head.ok && render.baseSource) {
          render.base = await deps.render(render.baseSource, baseRoot, 'base')
        }
      }
    }
  }
  finally {
    if (baseRoot) await deps.cleanupBase(baseRoot)
  }

  const results = renders.map(render => ({
    app: render.source.app,
    version: versionLabel(render),
    outcome: outcomeFor(render, input.maxDiffLines),
  }))

  const failed = countFailed(results)
  if (failed > 0) failures.push(`${failed} chart(s) failed to render`)

  // No chart sources at all means the extraction broke, not that everything is fine.
  if (sources.length === 0) failures.push('no charts were rendered — the apps/*.yaml extraction is broken')

  return {
    results,
    summary: renderSummary(results),
    hasChanges: results.some(result => result.outcome.status === 'changed'),
    annotations,
    failures,
  }
}
