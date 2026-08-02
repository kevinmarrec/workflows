import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { join } from 'pathe'
import { describe, expect, it } from 'vitest'

import type { ChartSource } from './application'
import { resourceKeys } from './compare'
import { renderChart } from './helm'

/**
 * The one test a mocked exec cannot replace: it proves the argv actually drives helm. Everything
 * else about rendering is asserted against a fake, so an argv mistake would otherwise go unnoticed.
 *
 * Probed synchronously because `it.runIf` is evaluated while tests are collected.
 */
const hasHelm = spawnSync('helm', ['version', '--short']).status === 0

const SEALED_SECRETS: ChartSource = {
  app: 'sealed-secrets',
  file: '.gitops/apps/sealed-secrets.yaml',
  namespace: 'kube-system',
  repo: 'https://bitnami.github.io/sealed-secrets',
  chart: 'sealed-secrets',
  revision: '2.18.6',
  valueFiles: [],
}

describe('renderChart against a published chart', () => {
  it.runIf(hasHelm)('renders the chart into the requested namespace', async () => {
    const result = await renderChart(SEALED_SECRETS, { root: '.' })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return

    expect(resourceKeys(result.manifests)).toContain('Deployment/sealed-secrets')
    expect(result.manifests).toContain('namespace: kube-system')
  }, 120_000)

  it.runIf(hasHelm)('applies a value file resolved against the tree root', async () => {
    const root = tmpdir()
    const values = `gitops-render-values-${process.pid}.yaml`
    await writeFile(join(root, values), 'fullnameOverride: renamed-by-values\n')

    const result = await renderChart({ ...SEALED_SECRETS, valueFiles: [values] }, { root })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return

    expect(resourceKeys(result.manifests)).toContain('Deployment/renamed-by-values')
  }, 120_000)

  it.runIf(hasHelm)('reports a failure for a version that does not exist', async () => {
    const result = await renderChart({ ...SEALED_SECRETS, revision: '0.0.0-nope' }, { root: '.' })

    expect(result.ok).toBe(false)
  }, 120_000)
})
