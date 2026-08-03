import { x } from 'tinyexec'

/**
 * The subprocess boundary. `git.ts` and `helm.ts` take one of these so their argv can be asserted
 * without spawning anything; the integration tests are what run the real binaries.
 */
export type Exec = (command: string, args: string[]) => Promise<{ stdout: string, stderr: string, exitCode: number | undefined }>

export const defaultExec: Exec = async (command, args) => x(command, args)
