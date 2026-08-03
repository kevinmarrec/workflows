import { type ChartSource, chartSources, UnsupportedSourceError } from './application'
import { compareManifests } from './compare'
import type { RenderResult } from './helm'
import { type AppOutcome, type AppResult, countFailed, renderSummary } from './summary'

export interface Deps {
  listApps: (glob: string) => Promise<string[]>
  readApp: (file: string) => Promise<string>
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

/** A chart source and what the two trees made of it. */
interface Render {
  source: ChartSource
  head: RenderResult
  base?: RenderResult
}

function outcomeFor({ source, head, base }: Render, maxDiffLines: number): AppOutcome {
  if (!head.ok) return { status: 'failed', stderr: head.stderr }

  // A base that is absent, unreadable, or broken is a missing baseline — never a change.
  if (!base) return { status: 'no-baseline', reason: 'missing' }
  if (!base.ok) return { status: 'no-baseline', reason: 'render-failed' }

  return compareManifests(source.app, base.manifests, head.manifests, maxDiffLines)
}

export async function main(input: RunInput, deps: Deps): Promise<RunOutput> {
  const annotations: RunOutput['annotations'] = []
  const failures: string[] = []
  const sources: ChartSource[] = []

  for (const file of await deps.listApps(input.apps)) {
    try {
      sources.push(...chartSources(await deps.readApp(file), file))
    }
    catch (error) {
      if (!(error instanceof UnsupportedSourceError)) throw error

      annotations.push({ file: error.file, message: error.message })
      failures.push(`${error.file}: ${error.message}`)
    }
  }

  const baseRoot = input.baseSha ? await deps.materializeBase(input.baseSha) : null
  const renders: Render[] = []

  try {
    // Every head render is attempted first, so one broken chart cannot hide a second.
    for (const source of sources) {
      const head = await deps.render(source, '.', 'head')
      renders.push({ source, head })

      if (!head.ok) {
        annotations.push({ file: source.file, message: `${source.chart} ${source.revision} failed to render\n${head.stderr}` })
      }
    }

    if (baseRoot) {
      for (const render of renders) {
        if (render.head.ok) render.base = await deps.render(render.source, baseRoot, 'base')
      }
    }
  }
  finally {
    if (baseRoot) await deps.cleanupBase(baseRoot)
  }

  const results = renders.map(render => ({
    app: render.source.app,
    version: `${render.source.chart} ${render.source.revision}`,
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
