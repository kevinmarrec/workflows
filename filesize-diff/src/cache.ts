import * as fs from 'node:fs'

import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { dirname } from 'pathe'

import type { FileStat } from './index'

const BRANCH_SEPARATORS_REGEX = /[^\w.-]/g

export type Baseline
  = | { status: 'restored', key: string }
    | { status: 'publishing', branch: string }
    | { status: 'missing', branch?: string }

export function loadCachedStats(cachePath: string): FileStat[] | null {
  if (!fs.existsSync(cachePath)) {
    return null
  }
  try {
    const content = fs.readFileSync(cachePath, 'utf-8')
    return JSON.parse(content)
  }
  catch {
    return null
  }
}

export function saveStats(stats: FileStat[], cachePath: string): void {
  const dir = dirname(cachePath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(cachePath, JSON.stringify(stats, null, 2))
}

/**
 * The branch whose published sizes this run compares against. A pull request compares against the
 * branch it targets, which is not always the default branch; anything else compares against the
 * default branch, whatever that repository happens to call it.
 */
export function baselineBranch(): string | undefined {
  const { eventName, payload } = github.context

  return eventName === 'pull_request'
    ? payload.pull_request?.base?.ref
    : payload.repository?.default_branch
}

/** A run on the baseline branch publishes the baseline rather than reading one. */
function onBaselineBranch(branch: string): boolean {
  return github.context.ref === `refs/heads/${branch}`
}

/** Branch names hold separators a cache key reads better without. */
function keyFor(cacheKey: string, branch: string): string {
  return `${cacheKey}-${branch.replace(BRANCH_SEPARATORS_REGEX, '-')}`
}

/**
 * Restores the baseline sizes of the branch being compared against.
 *
 * The result says which of the three situations happened, because a run with nothing to compare
 * is not the same as a run that found no difference, and the summary has to be able to say so.
 */
export async function restoreCache(cachePathBase: string, cacheKey: string): Promise<Baseline> {
  const branch = baselineBranch()

  if (!branch) {
    core.info('No baseline branch in the event payload — sizes will be reported without a comparison')
    return { status: 'missing' }
  }

  if (onBaselineBranch(branch)) {
    core.info(`Publishing the baseline for ${branch}, so there is nothing to restore`)
    return { status: 'publishing', branch }
  }

  const scopedKey = keyFor(cacheKey, branch)
  const restoreKeyPattern = `${scopedKey}-`

  core.info(`Restoring the ${branch} baseline with restore key pattern: ${restoreKeyPattern}`)

  const cacheHit = await cache.restoreCache([cachePathBase], scopedKey, [restoreKeyPattern])

  if (!cacheHit) {
    core.info(`No baseline found for ${branch}`)
    return { status: 'missing', branch }
  }

  core.info(`Cache restored from key: ${cacheHit}`)

  return { status: 'restored', key: cacheHit }
}

export async function saveCache(cachePathBase: string, cacheKey: string): Promise<void> {
  const branch = baselineBranch()

  if (!branch || !onBaselineBranch(branch)) {
    core.info('Skipping baseline cache save (not on the baseline branch)')
    return
  }

  // The sha keys it, so each commit on the baseline branch replaces the one before.
  const actualCacheKey = `${keyFor(cacheKey, branch)}-${github.context.sha}`

  core.info(`Attempting to save baseline cache with key: ${actualCacheKey}`)

  try {
    await cache.saveCache([cachePathBase], actualCacheKey)
    core.info('Baseline cache saved successfully (Cache reserved and uploaded)')
  }
  catch (error) {
    core.warning(`Failed to save baseline cache: ${error instanceof Error ? error.message : String(error)}`)
  }
}
