import { describe, expect, it } from 'vitest'

import { addWorktree, hasCommit, removeWorktree } from './git'
import type { Exec } from './helm'

function recordingExec(exitCode = 0) {
  const calls: { command: string, args: string[] }[] = []

  const exec: Exec = async (command, args) => {
    calls.push({ command, args })
    return { stdout: '', stderr: '', exitCode }
  }

  return { calls, exec }
}

describe('hasCommit', () => {
  it('confirms a commit that git can resolve', async () => {
    const { calls, exec } = recordingExec(0)

    await expect(hasCommit('abc123', exec)).resolves.toBe(true)
    expect(calls).toEqual([{ command: 'git', args: ['cat-file', '-e', 'abc123^{commit}'] }])
  })

  it('rejects a commit git cannot resolve', async () => {
    const { exec } = recordingExec(128)

    await expect(hasCommit('abc123', exec)).resolves.toBe(false)
  })

  it('rejects the all-zero sha a first push reports as the base', async () => {
    const { calls, exec } = recordingExec(0)

    await expect(hasCommit('0000000000000000000000000000000000000000', exec)).resolves.toBe(false)
    expect(calls).toEqual([])
  })
})

describe('addWorktree', () => {
  it('checks the commit out detached', async () => {
    const { calls, exec } = recordingExec()

    await addWorktree('abc123', '/tmp/base', exec)

    expect(calls).toEqual([{ command: 'git', args: ['worktree', 'add', '--detach', '/tmp/base', 'abc123'] }])
  })

  it('reports failure instead of throwing', async () => {
    const { exec } = recordingExec(1)

    await expect(addWorktree('abc123', '/tmp/base', exec)).resolves.toBe(false)
  })
})

describe('removeWorktree', () => {
  it('forces removal so a dirty base tree still cleans up', async () => {
    const { calls, exec } = recordingExec()

    await removeWorktree('/tmp/base', exec)

    expect(calls).toEqual([{ command: 'git', args: ['worktree', 'remove', '--force', '/tmp/base'] }])
  })
})
