import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { join } from 'pathe'
import { describe, expect, it } from 'vitest'

import { addWorktree, hasCommit, removeWorktree } from './git'

/**
 * Exercises the real `git` binary against this repository, the way the action does in CI.
 * The unit tests inject a fake exec, so nothing else proves the argv is accepted by git.
 */
const head = spawnSync('git', ['rev-parse', 'HEAD']).stdout.toString().trim()

describe('git against this repository', () => {
  it('confirms a commit that exists', async () => {
    await expect(hasCommit(head)).resolves.toBe(true)
  })

  it('rejects a commit that does not exist', async () => {
    await expect(hasCommit(`${'0'.repeat(39)}1`)).resolves.toBe(false)
  })

  it('checks a commit out detached, then removes it', async () => {
    const dest = join(tmpdir(), `gitops-render-worktree-${process.pid}`)

    await expect(addWorktree(head, dest)).resolves.toBe(true)
    expect(existsSync(join(dest, 'package.json'))).toBe(true)

    await removeWorktree(dest)
    expect(existsSync(dest)).toBe(false)
  })

  it('reports failure when the destination already exists', async () => {
    await expect(addWorktree(head, tmpdir())).resolves.toBe(false)
  })
})
