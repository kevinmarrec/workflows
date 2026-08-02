import type { Comparison } from './compare'

export type AppOutcome
  = | Comparison
    | { status: 'no-baseline', reason: 'render-failed' | 'missing' }
    | { status: 'failed', stderr: string }

export interface AppResult {
  app: string
  version: string
  outcome: AppOutcome
}

function renderOutcome({ app, version, outcome }: AppResult): string[] {
  const heading = `- **${app}** (${version})`

  switch (outcome.status) {
    case 'unchanged':
      return [`${heading} — unchanged`]

    case 'no-baseline':
      return outcome.reason === 'render-failed'
        ? [`${heading} — no baseline: the base commit failed to render it`]
        : [`${heading} — new, or no base to compare against`]

    case 'failed':
      return [`${heading} — **failed to render**`, '', '```', outcome.stderr, '```', '']

    case 'changed':
      return [
        `${heading} — changed`,
        ...outcome.added.map(key => `  - added: \`${key}\``),
        ...outcome.removed.map(key => `  - removed: \`${key}\``),
        '',
        `<details><summary>${app} render diff</summary>`,
        '',
        '```diff',
        outcome.patch,
        '```',
        '',
        '</details>',
        '',
      ]
  }
}

export function renderSummary(results: AppResult[]): string {
  const failed = results.filter(result => result.outcome.status === 'failed').length

  return [
    '## GitOps render',
    '',
    `\`${results.length - failed}\` chart(s) rendered, \`${failed}\` failure(s).`,
    '',
    ...results.flatMap(renderOutcome),
  ].join('\n')
}
