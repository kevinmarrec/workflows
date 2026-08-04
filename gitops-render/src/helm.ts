import { join } from 'pathe'

import type { ChartSource } from './application'
import { defaultExec, type Exec } from './exec'

export type RenderResult
  = | { ok: true, manifests: string }
    | { ok: false, stderr: string }

/**
 * Renders one chart source with `helm template`, resolving its value files against `root` — the tree
 * being rendered, so the base commit renders with the base commit's values.
 *
 * A chart that fails to render is a result, not an exception: the base commit is allowed to fail
 * (it may predate a fix, or reference a repo that has since moved) and must degrade to "no baseline".
 */
export async function renderChart(source: ChartSource, root: string, exec: Exec = defaultExec): Promise<RenderResult> {
  const args = [
    // Argo names the release after the chart; using anything else changes every metadata.name.
    'template',
    source.chart,
    source.chart,
    '--repo',
    source.repo,
    '--version',
    source.revision,
    '--namespace',
    source.namespace,
    // Argo CD applies the chart's crds/ directory unless the source sets skipCrds, and helm
    // template omits it unless asked. Without this, traefik renders 7 of the 32 objects Argo
    // deploys, and a bump that touches a CRD is invisible.
    '--include-crds',
    ...source.valueFiles.flatMap(file => ['-f', join(root, file)]),
  ]

  const { stdout, stderr, exitCode } = await exec('helm', args)

  return exitCode === 0 ? { ok: true, manifests: stdout } : { ok: false, stderr }
}
