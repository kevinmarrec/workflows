import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import * as core from '@actions/core'
import { join } from 'pathe'
import { glob } from 'tinyglobby'

import { addWorktree, hasCommit, removeWorktree } from './git'
import { renderChart } from './helm'
import { main } from './main'

/**
 * Wires the action inputs and outputs to the orchestrator. Everything with a decision in it lives
 * in main.ts, which is why this file is the only one excluded from coverage.
 */
export async function run(): Promise<void> {
  try {
    const output = await main({
      apps: core.getInput('apps'),
      baseSha: core.getInput('base-sha') || undefined,
      maxDiffLines: Number(core.getInput('max-diff-lines')),
    }, {
      // Paths stay relative to the tree they came from, so an annotation points at the
      // repository file rather than into the base worktree under /tmp.
      listApps: async (pattern, root) => (await glob([pattern], { cwd: root })).sort(),
      readApp: (root, file) => readFile(join(root, file), 'utf8'),

      render: async (source, root, tree) => {
        const result = await renderChart(source, root)
        core.info(`${tree}: ${source.app} ${result.ok ? 'ok' : 'FAIL'} ${source.chart} ${source.revision}`)
        return result
      },

      materializeBase: async (sha) => {
        if (!await hasCommit(sha)) {
          core.info(`no usable base commit (${sha}) — skipping the diff`)
          return null
        }

        const dest = join(tmpdir(), `gitops-render-base-${randomUUID()}`)

        return await addWorktree(sha, dest) ? dest : null
      },

      cleanupBase: removeWorktree,
    })

    for (const { file, message } of output.annotations) {
      core.error(message, { file, title: 'GitOps render' })
    }

    core.summary.addRaw(output.summary)
    await core.summary.write()

    core.startGroup('Render summary')
    core.info(output.summary)
    core.endGroup()

    core.setOutput('has-changes', String(output.hasChanges))

    if (output.failures.length > 0) core.setFailed(output.failures.join('\n'))
  }
  catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

run()
