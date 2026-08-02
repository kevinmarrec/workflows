import { describe, expect, it, vi } from 'vitest'

import type { ChartSource } from './application'
import type { RenderResult } from './helm'
import { type Deps, main, type RunInput } from './main'

function application(name: string, chart = name) {
  return `
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ${name}
spec:
  sources:
    - repoURL: https://charts.example.com
      chart: ${chart}
      targetRevision: 1.0.0
      helm:
        valueFiles:
          - $values/.gitops/values/${name}.yaml
  destination:
    namespace: ${name}
`
}

interface Scenario {
  apps?: Record<string, string>
  render?: (source: ChartSource, root: string) => Promise<RenderResult>
  materializeBase?: (sha: string) => Promise<string | null>
  input?: Partial<RunInput>
}

function scenario({ apps, render, materializeBase, input }: Scenario = {}) {
  const files = apps ?? { '.gitops/apps/traefik.yaml': application('traefik') }

  const cleanupBase = vi.fn(async () => {})

  const deps: Deps = {
    listApps: async () => Object.keys(files),
    readApp: async file => files[file],
    render: render ?? (async () => ({ ok: true, manifests: 'kind: Deployment\nmetadata:\n  name: x\n' })),
    materializeBase: materializeBase ?? (async () => '/tmp/base'),
    cleanupBase,
  }

  return {
    cleanupBase,
    run: () => main({ apps: '.gitops/apps/*.yaml', baseSha: 'abc123', maxDiffLines: 300, ...input }, deps),
  }
}

describe('main', () => {
  it('renders every chart against both the workspace and the base tree', async () => {
    const roots: string[] = []
    const { run } = scenario({
      render: async (_source, root) => {
        roots.push(root)
        return { ok: true, manifests: 'kind: Deployment\n' }
      },
    })

    await run()

    expect(roots).toEqual(['.', '/tmp/base'])
  })

  it('does not fail when the render differs from the base', async () => {
    const { run } = scenario({
      render: async (_source, root) => ({ ok: true, manifests: root === '.' ? 'replicas: 3\n' : 'replicas: 1\n' }),
    })

    const output = await run()

    expect(output.failures).toEqual([])
    expect(output.hasChanges).toBe(true)
    expect(output.results[0].outcome.status).toBe('changed')
  })

  it('reports no changes when both trees render the same output', async () => {
    const output = await scenario().run()

    expect(output.hasChanges).toBe(false)
    expect(output.results[0].outcome.status).toBe('unchanged')
  })

  it('fails and annotates when a chart does not render', async () => {
    const { run } = scenario({
      render: async () => ({ ok: false, stderr: 'Error: values don\'t meet the schema' }),
    })

    const output = await run()

    expect(output.failures).toHaveLength(1)
    expect(output.annotations).toEqual([{
      file: '.gitops/apps/traefik.yaml',
      message: expect.stringContaining('values don\'t meet the schema'),
    }])
  })

  it('attempts every chart before failing, so one break cannot hide another', async () => {
    const attempted: string[] = []
    const { run } = scenario({
      apps: {
        '.gitops/apps/traefik.yaml': application('traefik'),
        '.gitops/apps/zot.yaml': application('zot'),
      },
      render: async (source) => {
        attempted.push(source.app)
        return { ok: false, stderr: 'boom' }
      },
    })

    const output = await run()

    expect(attempted).toEqual(['traefik', 'zot'])
    expect(output.annotations).toHaveLength(2)
  })

  it('fails when the glob matches nothing renderable', async () => {
    const { run } = scenario({ apps: {} })

    const output = await run()

    expect(output.failures).toEqual([expect.stringContaining('no charts were rendered')])
  })

  it('degrades to no-baseline when the base commit cannot be checked out', async () => {
    const { run } = scenario({ materializeBase: async () => null })

    const output = await run()

    expect(output.failures).toEqual([])
    expect(output.results[0].outcome).toEqual({ status: 'no-baseline', reason: 'missing' })
  })

  it('degrades to no-baseline for a chart the base commit could not render', async () => {
    const { run } = scenario({
      render: async (_source, root) => root === '.'
        ? { ok: true, manifests: 'kind: Deployment\n' }
        : { ok: false, stderr: 'chart repo moved' },
    })

    const output = await run()

    expect(output.failures).toEqual([])
    expect(output.results[0].outcome).toEqual({ status: 'no-baseline', reason: 'render-failed' })
  })

  it('skips the base render entirely when no base sha is given', async () => {
    const roots: string[] = []
    const { run } = scenario({
      input: { baseSha: undefined },
      render: async (_source, root) => {
        roots.push(root)
        return { ok: true, manifests: 'kind: Deployment\n' }
      },
    })

    const output = await run()

    expect(roots).toEqual(['.'])
    expect(output.results[0].outcome).toEqual({ status: 'no-baseline', reason: 'missing' })
  })

  it('fails on an unsupported source while still rendering the other applications', async () => {
    const { run } = scenario({
      apps: {
        '.gitops/apps/traefik.yaml': application('traefik'),
        '.gitops/apps/zot.yaml': application('zot').replace('valueFiles:\n          - $values/.gitops/values/zot.yaml', 'valuesObject:\n          replicas: 2'),
      },
    })

    const output = await run()

    expect(output.failures).toHaveLength(1)
    expect(output.annotations).toEqual([{
      file: '.gitops/apps/zot.yaml',
      message: expect.stringContaining('valuesObject'),
    }])
    expect(output.results.find(result => result.app === 'traefik')?.outcome.status).toBe('unchanged')
  })

  it('propagates a failure that is not an unsupported source', async () => {
    const deps: Deps = {
      listApps: async () => ['.gitops/apps/traefik.yaml'],
      readApp: async () => { throw new Error('EACCES: permission denied') },
      render: async () => ({ ok: true, manifests: '' }),
      materializeBase: async () => null,
      cleanupBase: async () => {},
    }

    await expect(main({ apps: '.gitops/apps/*.yaml', maxDiffLines: 300 }, deps))
      .rejects
      .toThrow('EACCES: permission denied')
  })

  it('removes the base worktree once rendering is done', async () => {
    const { cleanupBase, run } = scenario()

    await run()

    expect(cleanupBase).toHaveBeenCalledWith('/tmp/base')
  })

  it('removes the base worktree even when a render throws', async () => {
    const { cleanupBase, run } = scenario({
      render: async () => { throw new Error('helm exploded') },
    })

    await expect(run()).rejects.toThrow('helm exploded')
    expect(cleanupBase).toHaveBeenCalledWith('/tmp/base')
  })
})
