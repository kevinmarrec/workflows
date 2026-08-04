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

/**
 * Puts a block inside its list item. A fence or a `<details>` left at column 0 closes the list,
 * renders on its own, and makes the next chart open a second list — so the diff of one chart
 * appears to sit between two others rather than under the one it belongs to.
 *
 * Blank lines stay empty: trailing spaces would be indentation with nothing to indent.
 */
function inListItem(lines: string[]): string[] {
  return lines.map(line => line ? `  ${line}` : line)
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
      return [
        `${heading} — **failed to render**`,
        '',
        ...inListItem(['```', ...outcome.stderr.split('\n'), '```']),
        '',
      ]

    case 'changed':
      return [
        `${heading} — changed`,
        ...outcome.added.map(key => `  - added: \`${key}\``),
        ...outcome.removed.map(key => `  - removed: \`${key}\``),
        '',
        // The chart is already named on the line above, so the summary does not repeat it.
        ...inListItem([
          '<details><summary>render diff</summary>',
          '',
          '```diff',
          ...outcome.patch.split('\n'),
          '```',
          '',
          '</details>',
        ]),
        '',
      ]
  }
}

/** Both the summary header and the job's exit status count these, so they count them the same way. */
export function countFailed(results: AppResult[]): number {
  return results.filter(result => result.outcome.status === 'failed').length
}

export function renderSummary(results: AppResult[]): string {
  const failed = countFailed(results)

  return [
    '## GitOps render',
    '',
    `\`${results.length - failed}\` chart(s) rendered, \`${failed}\` failure(s).`,
    '',
    ...results.flatMap(renderOutcome),
  ].join('\n')
}
