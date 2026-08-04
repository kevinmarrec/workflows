import { describe, expect, it, vi } from 'vitest'

import type { ChartSource } from './application'
import type { RenderResult } from './helm'
import { type Deps, main, type RunInput } from './main'

function application(name: string, chart = name, revision = '1.0.0') {
  return `
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ${name}
spec:
  sources:
    - repoURL: https://charts.example.com
      chart: ${chart}
      targetRevision: ${revision}
      helm:
        valueFiles:
          - $values/.gitops/values/${name}.yaml
  destination:
    namespace: ${name}
`
}

/** One Application, two chart legs — Argo allows it, and both share the Application's name. */
const MULTI_CHART = `
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: monitoring
spec:
  sources:
    - repoURL: https://charts.example.com
      chart: kube-prometheus-stack
      targetRevision: 1.0.0
    - repoURL: https://charts.example.com
      chart: prometheus-adapter
      targetRevision: 2.0.0
  destination:
    namespace: monitoring
`

interface Scenario {
  apps?: Record<string, string>
  /** The base tree's Applications. Defaults to the same manifests as the head tree. */
  baseApps?: Record<string, string>
  render?: (source: ChartSource, root: string) => Promise<RenderResult>
  materializeBase?: (sha: string) => Promise<string | null>
  input?: Partial<RunInput>
}

/** Renders manifests that carry the chart and revision, so a diff proves which pin was used. */
async function echoRender(source: ChartSource): Promise<RenderResult> {
  return {
    ok: true,
    manifests: `kind: Deployment\nmetadata:\n  name: ${source.chart}\n  labels:\n    version: ${source.revision}\n`,
  }
}

function scenario({ apps, baseApps, render, materializeBase, input }: Scenario = {}) {
  const files = apps ?? { '.gitops/apps/traefik.yaml': application('traefik') }
  const baseFiles = baseApps ?? files

  const cleanupBase = vi.fn(async () => {})
  const treeOf = (root: string) => root === '.' ? files : baseFiles

  const deps: Deps = {
    listApps: async (_glob, root) => Object.keys(treeOf(root)),
    readApp: async (root, file) => treeOf(root)[file],
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

  it('keeps the two chart legs of one Application apart', async () => {
    const { run } = scenario({
      apps: { '.gitops/apps/monitoring.yaml': MULTI_CHART },
      render: async source => source.chart === 'prometheus-adapter'
        ? { ok: false, stderr: 'Error: chart not found' }
        : { ok: true, manifests: 'kind: Deployment\n' },
    })

    const output = await run()

    expect(output.results.map(result => [result.version, result.outcome.status])).toEqual([
      ['kube-prometheus-stack 1.0.0', 'unchanged'],
      ['prometheus-adapter 2.0.0', 'failed'],
    ])
  })

  it('renders the base tree with the chart version the base tree pinned', async () => {
    const { run } = scenario({
      apps: { '.gitops/apps/argocd.yaml': application('argocd', 'argo-cd', '10.2.2') },
      baseApps: { '.gitops/apps/argocd.yaml': application('argocd', 'argo-cd', '9.5.17') },
      render: echoRender,
    })

    const output = await run()

    expect(output.hasChanges).toBe(true)
    expect(output.results[0].outcome.status).toBe('changed')
  })

  it('shows the bump in the version label when the pin moved', async () => {
    const { run } = scenario({
      apps: { '.gitops/apps/argocd.yaml': application('argocd', 'argo-cd', '10.2.2') },
      baseApps: { '.gitops/apps/argocd.yaml': application('argocd', 'argo-cd', '9.5.17') },
      render: echoRender,
    })

    expect((await run()).results[0].version).toBe('argo-cd 9.5.17 → 10.2.2')
  })

  it('has no baseline for a chart the base tree did not declare', async () => {
    const { run } = scenario({
      apps: { '.gitops/apps/zot.yaml': application('zot') },
      baseApps: {},
    })

    const output = await run()

    expect(output.failures).toEqual([])
    expect(output.results[0].outcome).toEqual({ status: 'no-baseline', reason: 'missing' })
  })

  it('ignores an Application the base tree declares and this one does not', async () => {
    const { run } = scenario({
      apps: { '.gitops/apps/zot.yaml': application('zot') },
      baseApps: {
        '.gitops/apps/zot.yaml': application('zot'),
        '.gitops/apps/gone.yaml': application('gone'),
      },
    })

    const output = await run()

    expect(output.results.map(result => result.app)).toEqual(['zot'])
  })

  it('does not fail the job for an unsupported feature in the base tree only', async () => {
    const { run } = scenario({
      apps: { '.gitops/apps/zot.yaml': application('zot') },
      baseApps: {
        '.gitops/apps/zot.yaml': application('zot').replace(
          'valueFiles:\n          - $values/.gitops/values/zot.yaml',
          'valuesObject:\n          replicas: 2',
        ),
      },
    })

    const output = await run()

    expect(output.failures).toEqual([])
    expect(output.annotations).toEqual([])
    expect(output.results[0].outcome).toEqual({ status: 'no-baseline', reason: 'missing' })
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
