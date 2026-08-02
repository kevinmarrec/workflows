import { createTwoFilesPatch } from 'diff'
import { parseAllDocuments } from 'yaml'

export type Comparison
  = | { status: 'unchanged' }
    | { status: 'changed', added: string[], removed: string[], patch: string }

interface Resource {
  kind?: string
  metadata?: { name?: string }
}

/**
 * Identifies every resource in a render as `Kind/name`.
 *
 * A chart flipping a default on or off adds or removes whole resources while still rendering
 * successfully — the signal a line diff buries and a bare render misses entirely.
 */
export function resourceKeys(manifests: string): string[] {
  const keys = parseAllDocuments(manifests)
    .map(document => document.toJS() as Resource | null)
    .filter(resource => resource?.kind && resource.metadata?.name)
    .map(resource => `${resource!.kind}/${resource!.metadata!.name}`)

  return [...new Set(keys)].sort()
}

function truncate(patch: string, maxDiffLines: number): string {
  const lines = patch.split('\n')

  if (lines.length <= maxDiffLines) return patch

  return [...lines.slice(0, maxDiffLines), `... ${lines.length - maxDiffLines} more lines`].join('\n')
}

export function compareManifests(app: string, base: string, head: string, maxDiffLines: number): Comparison {
  if (base === head) return { status: 'unchanged' }

  const baseKeys = new Set(resourceKeys(base))
  const headKeys = new Set(resourceKeys(head))

  return {
    status: 'changed',
    added: [...headKeys].filter(key => !baseKeys.has(key)),
    removed: [...baseKeys].filter(key => !headKeys.has(key)),
    patch: truncate(createTwoFilesPatch(`${app} (base)`, `${app} (head)`, base, head), maxDiffLines),
  }
}
