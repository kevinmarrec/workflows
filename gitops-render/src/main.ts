import { type ChartSource, chartSources, UnsupportedSourceError } from './application'
import { compareManifests } from './compare'
import type { RenderResult } from './helm'
import { type AppOutcome, type AppResult, renderSummary } from './summary'

export interface Deps {
  listApps: (glob: string) => Promise<string[]>
  readApp: (file: string) => Promise<string>
  render: (source: ChartSource, root: string) => Promise<RenderResult>
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

function outcomeFor(
  source: ChartSource,
  head: RenderResult,
  base: RenderResult | undefined,
  maxDiffLines: number,
): AppOutcome {
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
  const head = new Map<string, RenderResult>()
  const base = new Map<string, RenderResult>()

  try {
    for (const source of sources) {
      const result = await deps.render(source, '.')
      head.set(source.app, result)

      if (!result.ok) {
        annotations.push({ file: source.file, message: `${source.chart} ${source.revision} failed to render\n${result.stderr}` })
      }
    }

    if (baseRoot) {
      for (const source of sources) {
        if (head.get(source.app)?.ok) base.set(source.app, await deps.render(source, baseRoot))
      }
    }
  }
  finally {
    if (baseRoot) await deps.cleanupBase(baseRoot)
  }

  const results = sources.map(source => ({
    app: source.app,
    version: `${source.chart} ${source.revision}`,
    outcome: outcomeFor(source, head.get(source.app)!, base.get(source.app), input.maxDiffLines),
  }))

  const failed = results.filter(result => result.outcome.status === 'failed').length
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
