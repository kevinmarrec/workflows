import { join } from 'pathe'
import { x } from 'tinyexec'

import type { ChartSource } from './application'

export type Exec = (command: string, args: string[]) => Promise<{ stdout: string, stderr: string, exitCode: number | undefined }>

export type RenderResult
  = | { ok: true, manifests: string }
    | { ok: false, stderr: string }

interface RenderOptions {
  /** Root of the tree being rendered. Value files resolve against it, so base renders with base values. */
  root: string
  exec?: Exec
}

const defaultExec: Exec = async (command, args) => x(command, args)

/**
 * Renders one chart source with `helm template`.
 *
 * A chart that fails to render is a result, not an exception: the base commit is allowed to fail
 * (it may predate a fix, or reference a repo that has since moved) and must degrade to "no baseline".
 */
export async function renderChart(source: ChartSource, options: RenderOptions): Promise<RenderResult> {
  const exec = options.exec ?? defaultExec

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
    ...source.valueFiles.flatMap(file => ['-f', join(options.root, file)]),
  ]

  const { stdout, stderr, exitCode } = await exec('helm', args)

  return exitCode === 0 ? { ok: true, manifests: stdout } : { ok: false, stderr }
}
