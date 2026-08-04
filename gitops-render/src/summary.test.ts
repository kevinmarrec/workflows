import { describe, expect, it } from 'vitest'

import { type AppResult, renderSummary } from './summary'

const unchanged: AppResult = {
  app: 'cert-manager',
  version: 'cert-manager v1.16.2',
  outcome: { status: 'unchanged' },
}

describe('renderSummary', () => {
  it('counts rendered charts and failures in the header', () => {
    const failed: AppResult = { app: 'zot', version: 'zot 0.1.70', outcome: { status: 'failed', stderr: 'Error: chart not found' } }

    expect(renderSummary([unchanged, failed])).toContain('`1` chart(s) rendered, `1` failure(s).')
  })

  it('reports an unchanged chart on a single line', () => {
    expect(renderSummary([unchanged])).toContain('- **cert-manager** (cert-manager v1.16.2) — unchanged')
  })

  it('lists added and removed resources for a changed chart', () => {
    const summary = renderSummary([{
      app: 'traefik',
      version: 'traefik 41.1.0',
      outcome: {
        status: 'changed',
        added: ['ServiceAccount/traefik'],
        removed: ['Ingress/traefik-dashboard'],
        patch: '@@ -1 +1 @@',
      },
    }])

    expect(summary).toContain('- **traefik** (traefik 41.1.0) — changed')
    expect(summary).toContain('- added: `ServiceAccount/traefik`')
    expect(summary).toContain('- removed: `Ingress/traefik-dashboard`')
  })

  it('puts the patch of a changed chart behind a details block', () => {
    const summary = renderSummary([{
      app: 'traefik',
      version: 'traefik 41.1.0',
      outcome: { status: 'changed', added: [], removed: [], patch: '@@ -1 +1 @@\n-a\n+b' },
    }])

    expect(summary).toContain('<details><summary>traefik render diff</summary>')
    expect(summary).toContain('```diff\n@@ -1 +1 @@\n-a\n+b\n```')
  })

  it('distinguishes a base commit that failed to render from one that never existed', () => {
    const results: AppResult[] = [
      { app: 'sealed-secrets', version: 'sealed-secrets 2.18.0', outcome: { status: 'no-baseline', reason: 'render-failed' } },
      { app: 'umami', version: 'umami 0.20.0', outcome: { status: 'no-baseline', reason: 'missing' } },
    ]

    const summary = renderSummary(results)

    expect(summary).toContain('- **sealed-secrets** (sealed-secrets 2.18.0) — no baseline: the base commit failed to render it')
    expect(summary).toContain('- **umami** (umami 0.20.0) — new, or no base to compare against')
  })

  it('reports a failed chart with its helm error', () => {
    const summary = renderSummary([{
      app: 'zot',
      version: 'zot 0.1.70',
      outcome: { status: 'failed', stderr: 'Error: values don\'t meet the schema' },
    }])

    expect(summary).toContain('- **zot** (zot 0.1.70) — **failed to render**')
    expect(summary).toContain('Error: values don\'t meet the schema')
  })
})
