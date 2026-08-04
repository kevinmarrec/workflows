import type { Exec } from './exec'

/** An `Exec` that spawns nothing, records the argv it was handed, and returns a canned result. */
export function recordingExec(result: Partial<Awaited<ReturnType<Exec>>> = {}) {
  const calls: { command: string, args: string[] }[] = []

  const exec: Exec = async (command, args) => {
    calls.push({ command, args })
    return { stdout: '', stderr: '', exitCode: 0, ...result }
  }

  return { calls, exec }
}
