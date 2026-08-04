import { defaultExec, type Exec } from './exec'

/** `github.event.before` on a branch's first push. There is no such commit to diff against. */
const EMPTY_SHA = '0'.repeat(40)

export async function hasCommit(sha: string, exec: Exec = defaultExec): Promise<boolean> {
  if (sha === EMPTY_SHA) return false

  const { exitCode } = await exec('git', ['cat-file', '-e', `${sha}^{commit}`])

  return exitCode === 0
}

/** Checks the base commit out beside the workspace, so both trees render through the same path. */
export async function addWorktree(sha: string, dest: string, exec: Exec = defaultExec): Promise<boolean> {
  const { exitCode } = await exec('git', ['worktree', 'add', '--detach', dest, sha])

  return exitCode === 0
}

export async function removeWorktree(dest: string, exec: Exec = defaultExec): Promise<void> {
  await exec('git', ['worktree', 'remove', '--force', dest])
}
