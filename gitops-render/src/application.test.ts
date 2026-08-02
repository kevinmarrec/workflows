import { describe, expect, it } from 'vitest'

import { chartSources, UnsupportedSourceError } from './application'

function chartApp(source: string) {
  return `
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: traefik
spec:
  sources:
    - repoURL: https://traefik.github.io/charts
      chart: traefik
      targetRevision: 41.1.0
${source}
  destination:
    namespace: traefik
`
}

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

const PATH_ONLY = `
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: blueprint
spec:
  project: workloads
  source:
    repoURL: https://github.com/kevinmarrec/blueprint
    targetRevision: HEAD
    path: .gitops/manifests/blueprint
    directory:
      recurse: true
  destination:
    server: https://kubernetes.default.svc
    namespace: blueprint
`

describe('chartSources', () => {
  it('extracts the chart leg of a multi-source Application', () => {
    expect(chartSources(TRAEFIK, '.gitops/apps/traefik.yaml')).toEqual([{
      app: 'traefik',
      file: '.gitops/apps/traefik.yaml',
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
    expect(chartSources(PATH_ONLY, '.gitops/apps/blueprint.yaml')).toEqual([])
  })

  it('rejects a chart source using helm.valuesObject', () => {
    const app = chartApp('      helm:\n        valuesObject:\n          replicas: 2')

    expect(() => chartSources(app, '.gitops/apps/traefik.yaml'))
      .toThrow(new UnsupportedSourceError('.gitops/apps/traefik.yaml', 'chart source "traefik" uses helm.valuesObject, which this action does not render'))
  })

  it('rejects a chart source using helm.parameters', () => {
    const app = chartApp('      helm:\n        parameters:\n          - name: replicas\n            value: "2"')

    expect(() => chartSources(app, '.gitops/apps/traefik.yaml'))
      .toThrow(UnsupportedSourceError)
  })

  it('rejects a chart source with no destination namespace', () => {
    const app = `
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: traefik
spec:
  sources:
    - repoURL: https://traefik.github.io/charts
      chart: traefik
      targetRevision: 41.1.0
  destination:
    server: https://kubernetes.default.svc
`

    expect(() => chartSources(app, '.gitops/apps/traefik.yaml'))
      .toThrow(UnsupportedSourceError)
  })

  it('rejects a source that is neither a chart, a path, nor a values ref', () => {
    const app = `
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: traefik
spec:
  sources:
    - repoURL: https://github.com/kevinmarrec/blueprint
      targetRevision: HEAD
      plugin:
        name: kustomize-build
  destination:
    namespace: traefik
`

    expect(() => chartSources(app, '.gitops/apps/traefik.yaml'))
      .toThrow(UnsupportedSourceError)
  })
})
