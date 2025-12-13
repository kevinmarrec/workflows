import * as fs from 'node:fs'

import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { dirname } from 'pathe'

import type { FileStat } from './index'

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

export async function restoreCache(cachePathBase: string, cacheKey: string): Promise<string | undefined> {
  const isMainBranch = github.context.ref === 'refs/heads/main'

  // Restore cache only on non-main branches (for comparison)
  // On main branch, we skip restore since we're creating the baseline
  if (!isMainBranch) {
    // Use restore key pattern to find the latest main branch cache
    const restoreKeyPattern = `${cacheKey}-`
    core.info(`Restoring cache with restore key pattern: ${restoreKeyPattern}`)
    const cacheHit = await cache.restoreCache([cachePathBase], cacheKey, [restoreKeyPattern])
    if (cacheHit) {
      core.info(`Cache restored from key: ${cacheHit}`)
      return cacheHit
    }
    else {
      core.info('No cache found')
      return undefined
    }
  }
  else {
    core.info('Skipping cache restore on main branch (no comparison needed)')
    return undefined
  }
}

export async function saveCache(cachePathBase: string, cacheKey: string): Promise<void> {
  const isMainBranch = github.context.ref === 'refs/heads/main'

  // Save cache only on main branch (to create baseline for PR comparisons)
  // Use unique key with commit SHA to ensure cache updates on each commit
  if (isMainBranch) {
    const actualCacheKey = `${cacheKey}-${github.context.sha}`
    core.info(`Attempting to save baseline cache with key: ${actualCacheKey}`)
    try {
      await cache.saveCache([cachePathBase], actualCacheKey)
      core.info('Baseline cache saved successfully (Cache reserved and uploaded)')
    }
    catch (error) {
      core.warning(`Failed to save baseline cache: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  else {
    core.info('Skipping baseline cache save (not on main branch)')
  }
}
