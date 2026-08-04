import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'

import { chartSources, UnsupportedSourceError } from './application'

const FILE = '.gitops/apps/traefik.yaml'

/** A well-formed chart source, spread and overridden by the tests that vary one field of it. */
const CHART = {
  repoURL: 'https://traefik.github.io/charts',
  chart: 'traefik',
  targetRevision: '41.1.0',
}

const DESTINATION = { namespace: 'traefik' }

/** Builds an Application around `spec`, so each test shows only what it varies. */
function app(spec: Record<string, unknown>) {
  return stringify({
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Application',
    metadata: { name: 'traefik' },
    spec,
  })
}

/**
 * These two stay verbatim: their shape — a chart leg beside a `$values` ref and a path, an
 * AppProject sitting in the same directory — is what the parser exists to handle, and paraphrasing
 * it into object literals would hide the thing under test.
 */
const TRAEFIK = `
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: traefik
spec:
  project: infrastructure
  sources:
    - repoURL: https://traefik.github.io/charts
      chart: traefik
      targetRevision: 41.1.0
      helm:
        valueFiles:
          - $values/.gitops/values/traefik.yaml
    - repoURL: https://github.com/kevinmarrec/blueprint
      targetRevision: HEAD
      ref: values
    - repoURL: https://github.com/kevinmarrec/blueprint
      targetRevision: HEAD
      path: .gitops/manifests/traefik
  destination:
    server: https://kubernetes.default.svc
    namespace: traefik
`

const APP_PROJECT = `
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: infrastructure
spec:
  description: Core infrastructure components
  sourceRepos:
    - https://traefik.github.io/charts
  destinations:
    - server: https://kubernetes.default.svc
      namespace: '*'
`

describe('chartSources', () => {
  it('extracts the chart leg of a multi-source Application', () => {
    expect(chartSources(TRAEFIK, FILE)).toEqual([{
      app: 'traefik',
      file: FILE,
      namespace: 'traefik',
      repo: 'https://traefik.github.io/charts',
      chart: 'traefik',
      revision: '41.1.0',
      valueFiles: ['.gitops/values/traefik.yaml'],
    }])
  })

  it('skips a manifest that is not an Application', () => {
    expect(chartSources(APP_PROJECT, '.gitops/apps/project-infrastructure.yaml')).toEqual([])
  })

  it('skips an Application whose only source is a repository path', () => {
    const manifest = app({
      source: { repoURL: 'https://github.com/kevinmarrec/blueprint', targetRevision: 'HEAD', path: '.gitops/manifests/blueprint', directory: { recurse: true } },
      destination: DESTINATION,
    })

    expect(chartSources(manifest, FILE)).toEqual([])
  })

  it('rejects a chart source using helm.valuesObject', () => {
    const manifest = app({
      sources: [{ ...CHART, helm: { valuesObject: { replicas: 2 } } }],
      destination: DESTINATION,
    })

    expect(() => chartSources(manifest, FILE))
      .toThrow(new UnsupportedSourceError(FILE, 'chart source "traefik" uses helm.valuesObject, which this action does not render'))
  })

  it('rejects a chart source using helm.parameters', () => {
    const manifest = app({
      sources: [{ ...CHART, helm: { parameters: [{ name: 'replicas', value: '2' }] } }],
      destination: DESTINATION,
    })

    expect(() => chartSources(manifest, FILE)).toThrow(UnsupportedSourceError)
  })

  it('rejects a chart source with no destination namespace', () => {
    const manifest = app({ sources: [CHART], destination: { server: 'https://kubernetes.default.svc' } })

    expect(() => chartSources(manifest, FILE)).toThrow(UnsupportedSourceError)
  })

  it('rejects a chart source with no repoURL', () => {
    const manifest = app({ sources: [{ ...CHART, repoURL: undefined }], destination: DESTINATION })

    expect(() => chartSources(manifest, FILE)).toThrow(UnsupportedSourceError)
  })

  it('rejects a chart source with no targetRevision', () => {
    const manifest = app({ sources: [{ ...CHART, targetRevision: undefined }], destination: DESTINATION })

    expect(() => chartSources(manifest, FILE)).toThrow(UnsupportedSourceError)
  })

  it('renders a chart source that declares no helm block', () => {
    const manifest = app({ sources: [CHART], destination: DESTINATION })

    expect(chartSources(manifest, FILE)[0].valueFiles).toEqual([])
  })

  it('skips an Application that declares no source at all', () => {
    expect(chartSources(app({ destination: DESTINATION }), FILE)).toEqual([])
  })

  it('names an unrecognised source even when it has no repoURL', () => {
    const manifest = app({ sources: [{ plugin: { name: 'kustomize-build' } }], destination: DESTINATION })

    expect(() => chartSources(manifest, FILE))
      .toThrow('source (no repoURL) is neither a chart, a repository path, nor a values ref')
  })

  it('rejects a source that is neither a chart, a path, nor a values ref', () => {
    const manifest = app({
      sources: [{ repoURL: 'https://github.com/kevinmarrec/blueprint', targetRevision: 'HEAD', plugin: { name: 'kustomize-build' } }],
      destination: DESTINATION,
    })

    expect(() => chartSources(manifest, FILE)).toThrow(UnsupportedSourceError)
  })
})
