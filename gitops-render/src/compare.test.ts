import { describe, expect, it } from 'vitest'

import { compareManifests, resourceKeys } from './compare'

const DEPLOYMENT = `---
# Source: traefik/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: traefik
spec:
  replicas: 1
`

const WITH_SERVICE_ACCOUNT = `${DEPLOYMENT}---
# Source: traefik/templates/serviceaccount.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: traefik
`

describe('resourceKeys', () => {
  it('keys each document by kind and name', () => {
    expect(resourceKeys(WITH_SERVICE_ACCOUNT)).toEqual(['Deployment/traefik', 'ServiceAccount/traefik'])
  })

  it('ignores empty documents', () => {
    expect(resourceKeys(`---\n\n${DEPLOYMENT}---\n# just a comment\n`)).toEqual(['Deployment/traefik'])
  })
})

describe('compareManifests', () => {
  it('reports unchanged when the render is identical', () => {
    expect(compareManifests('traefik', DEPLOYMENT, DEPLOYMENT, 300))
      .toEqual({ status: 'unchanged' })
  })

  it('reports a resource the chart started emitting', () => {
    const result = compareManifests('traefik', DEPLOYMENT, WITH_SERVICE_ACCOUNT, 300)

    expect(result).toMatchObject({ status: 'changed', added: ['ServiceAccount/traefik'], removed: [] })
  })

  it('reports a resource the chart stopped emitting', () => {
    const result = compareManifests('traefik', WITH_SERVICE_ACCOUNT, DEPLOYMENT, 300)

    expect(result).toMatchObject({ status: 'changed', added: [], removed: ['ServiceAccount/traefik'] })
  })

  it('reports a changed field with no added or removed resource', () => {
    const scaled = DEPLOYMENT.replace('replicas: 1', 'replicas: 3')
    const result = compareManifests('traefik', DEPLOYMENT, scaled, 300)

    expect(result).toMatchObject({ status: 'changed', added: [], removed: [] })
    expect(result).toHaveProperty('patch', expect.stringContaining('+  replicas: 3'))
  })

  it('truncates a patch longer than the line budget', () => {
    const long = `${DEPLOYMENT}${Array.from({ length: 400 }, (_, i) => `# line ${i}`).join('\n')}\n`
    const result = compareManifests('traefik', DEPLOYMENT, long, 10)

    if (result.status !== 'changed') throw new Error('expected a changed comparison')

    const lines = result.patch.split('\n')
    expect(lines).toHaveLength(11)
    expect(lines.at(-1)).toMatch(/more lines/)
  })
})
