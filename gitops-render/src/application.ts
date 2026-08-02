import { basename } from 'pathe'
import { parse } from 'yaml'

/** The only `helm` keys the renderer implements. Anything else would render wrong output. */
const SUPPORTED_HELM_KEYS = ['valueFiles']

const VALUES_MARKER = /^\$values\//

interface RawSource {
  repoURL?: string
  chart?: string
  path?: string
  ref?: string
  targetRevision?: string | number
  helm?: Record<string, unknown>
}

interface RawApplication {
  kind?: string
  spec?: {
    source?: RawSource
    sources?: RawSource[]
    destination?: { namespace?: string }
  }
}

export interface ChartSource {
  app: string
  file: string
  namespace: string
  repo: string
  chart: string
  revision: string
  valueFiles: string[]
}

/**
 * An Application uses an Argo CD feature this action does not implement. Rendering it anyway
 * would produce output that differs from what Argo deploys, so this is always fatal.
 */
export class UnsupportedSourceError extends Error {
  readonly file: string

  constructor(file: string, message: string) {
    super(message)
    this.name = 'UnsupportedSourceError'
    this.file = file
  }
}

/**
 * Extracts the renderable chart sources from an Argo CD Application.
 *
 * Sources Argo resolves without Helm (repository paths, the `$values` ref) are skipped, as are
 * manifests that are not Applications at all. Everything else throws rather than render silently.
 */
export function chartSources(text: string, file: string): ChartSource[] {
  const doc = parse(text) as RawApplication | null

  // apps/ also holds AppProject manifests, which reference repositories without rendering any.
  if (doc?.kind !== 'Application') return []

  const app = basename(file, '.yaml')
  const namespace = doc.spec?.destination?.namespace
  const sources = doc.spec?.sources ?? [doc.spec?.source]
  const charts: ChartSource[] = []

  for (const source of sources) {
    if (!source) continue

    if (source.chart) {
      const unsupported = Object.keys(source.helm ?? {}).filter(key => !SUPPORTED_HELM_KEYS.includes(key))

      if (unsupported.length > 0) {
        throw new UnsupportedSourceError(file, `chart source "${source.chart}" uses helm.${unsupported[0]}, which this action does not render`)
      }

      if (!namespace) {
        throw new UnsupportedSourceError(file, `chart source "${source.chart}" has no spec.destination.namespace`)
      }

      // Without it helm would be handed `--repo ""`, and fail far from the cause.
      if (!source.repoURL) {
        throw new UnsupportedSourceError(file, `chart source "${source.chart}" has no repoURL`)
      }

      charts.push({
        app,
        file,
        namespace,
        repo: source.repoURL,
        chart: source.chart,
        revision: String(source.targetRevision),
        valueFiles: ((source.helm?.valueFiles ?? []) as string[]).map(path => path.replace(VALUES_MARKER, '')),
      })

      continue
    }

    // Argo applies these directly, and the `$values` ref only anchors valueFiles paths.
    if (source.path || source.ref) continue

    throw new UnsupportedSourceError(file, `source ${source.repoURL ?? '(no repoURL)'} is neither a chart, a repository path, nor a values ref`)
  }

  return charts
}
