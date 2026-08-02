import { describe, expect, it } from 'vitest'

import type { ChartSource } from './application'
import { type Exec, renderChart } from './helm'

const TRAEFIK: ChartSource = {
  app: 'traefik',
  file: '.gitops/apps/traefik.yaml',
  namespace: 'traefik',
  repo: 'https://traefik.github.io/charts',
  chart: 'traefik',
  revision: '41.1.0',
  valueFiles: ['.gitops/values/traefik.yaml'],
}

function recordingExec(result: Partial<Awaited<ReturnType<Exec>>> = {}) {
  const calls: { command: string, args: string[] }[] = []

  const exec: Exec = async (command, args) => {
    calls.push({ command, args })
    return { stdout: '', stderr: '', exitCode: 0, ...result }
  }

  return { calls, exec }
}

describe('renderChart', () => {
  it('builds the helm argv from the chart source', async () => {
    const { calls, exec } = recordingExec()

    await renderChart(TRAEFIK, { root: '/tmp/base', exec })

    expect(calls).toEqual([{
      command: 'helm',
      args: [
        'template',
        'traefik',
        'traefik',
        '--repo',
        'https://traefik.github.io/charts',
        '--version',
        '41.1.0',
        '--namespace',
        'traefik',
        '-f',
        '/tmp/base/.gitops/values/traefik.yaml',
      ],
    }])
  })

  it('resolves every value file against the tree being rendered', async () => {
    const { calls, exec } = recordingExec()
    const source = { ...TRAEFIK, valueFiles: ['.gitops/values/common.yaml', '.gitops/values/traefik.yaml'] }

    await renderChart(source, { root: '/tmp/head', exec })

    expect(calls[0].args.slice(-4)).toEqual([
      '-f',
      '/tmp/head/.gitops/values/common.yaml',
      '-f',
      '/tmp/head/.gitops/values/traefik.yaml',
    ])
  })

  it('passes no -f flag when the source has no value files', async () => {
    const { calls, exec } = recordingExec()

    await renderChart({ ...TRAEFIK, valueFiles: [] }, { root: '/tmp/head', exec })

    expect(calls[0].args).not.toContain('-f')
  })

  it('returns the rendered manifests when helm succeeds', async () => {
    const { exec } = recordingExec({ stdout: 'kind: Deployment\n', exitCode: 0 })

    await expect(renderChart(TRAEFIK, { root: '/tmp/head', exec }))
      .resolves
      .toEqual({ ok: true, manifests: 'kind: Deployment\n' })
  })

  it('returns helm stderr when the chart fails to render', async () => {
    const { exec } = recordingExec({ stderr: 'Error: values don\'t meet the schema', exitCode: 1 })

    await expect(renderChart(TRAEFIK, { root: '/tmp/head', exec }))
      .resolves
      .toEqual({ ok: false, stderr: 'Error: values don\'t meet the schema' })
  })
})
