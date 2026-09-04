import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { baselineBranch, loadCachedStats, restoreCache, saveCache, saveStats } from './cache'
import type { FileStat } from './index'

vi.mock('@actions/cache')
vi.mock('@actions/core')
vi.mock('@actions/github', () => ({
  context: {
    ref: '',
    sha: '',
    eventName: '',
    payload: {},
  },
}))

/** Shapes `github.context` like a real run, so the branch resolution is exercised, not stubbed. */
function pushTo(branch: string, defaultBranch = 'main') {
  Object.assign(github.context, {
    ref: `refs/heads/${branch}`,
    sha: 'abc123',
    eventName: 'push',
    payload: { repository: { default_branch: defaultBranch } },
  })
}

function pullRequestInto(base: string, defaultBranch = 'main') {
  Object.assign(github.context, {
    // A pull_request run checks out the merge ref, never the head branch.
    ref: 'refs/pull/7/merge',
    sha: 'abc123',
    eventName: 'pull_request',
    payload: { repository: { default_branch: defaultBranch }, pull_request: { base: { ref: base } } },
  })
}

describe('loadCachedStats', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should handle all cache scenarios', () => {
    expect(loadCachedStats(path.join(tempDir, 'nonexistent.json'))).toBeNull()

    const cachePath = path.join(tempDir, 'cache.json')
    const stats: FileStat[] = [{ file: 'index.html', size: 100 }]
    fs.writeFileSync(cachePath, JSON.stringify(stats, null, 2))
    expect(loadCachedStats(cachePath)).toEqual(stats)

    fs.writeFileSync(cachePath, 'invalid json')
    expect(loadCachedStats(cachePath)).toBeNull()
  })
})

describe('saveStats', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should save stats and create directories', () => {
    const cachePath = path.join(tempDir, 'nested', 'dir', 'cache.json')
    const stats: FileStat[] = [{ file: 'test.js', size: 50 }]
    saveStats(stats, cachePath)
    expect(fs.existsSync(cachePath)).toBe(true)
    expect(JSON.parse(fs.readFileSync(cachePath, 'utf-8'))).toEqual(stats)
  })
})

describe('baselineBranch', () => {
  it('is the branch a pull request targets, not the default branch', () => {
    pullRequestInto('release/v2')

    expect(baselineBranch()).toBe('release/v2')
  })

  it('is the repository default branch outside a pull request', () => {
    pushTo('some-feature', 'master')

    expect(baselineBranch()).toBe('master')
  })

  it('is undefined when the payload names no branch', () => {
    Object.assign(github.context, { ref: 'refs/heads/x', eventName: 'push', payload: {} })

    expect(baselineBranch()).toBeUndefined()
  })
})

describe('restoreCache', () => {
  beforeEach(() => {
    vi.mocked(core.info).mockImplementation(() => {})
  })

  it('restores the baseline of the branch the pull request targets', async () => {
    vi.mocked(cache.restoreCache).mockResolvedValue('cache-key-main-123')
    pullRequestInto('main')

    const result = await restoreCache('/path/to/cache', 'cache-key')

    expect(result).toEqual({ status: 'restored', key: 'cache-key-main-123' })
    expect(cache.restoreCache).toHaveBeenCalledWith(
      ['/path/to/cache'],
      'cache-key-main',
      ['cache-key-main-'],
    )
  })

  it('scopes the key to the base branch, so a release PR cannot read the default branch baseline', async () => {
    vi.mocked(cache.restoreCache).mockResolvedValue(undefined)
    pullRequestInto('release/v2')

    await restoreCache('/path/to/cache', 'cache-key')

    expect(cache.restoreCache).toHaveBeenCalledWith(
      ['/path/to/cache'],
      'cache-key-release-v2',
      ['cache-key-release-v2-'],
    )
  })

  it('reports a missing baseline instead of returning nothing', async () => {
    vi.mocked(cache.restoreCache).mockResolvedValue(undefined)
    pullRequestInto('main')

    await expect(restoreCache('/path/to/cache', 'cache-key'))
      .resolves
      .toEqual({ status: 'missing', branch: 'main' })
  })

  it('publishes rather than restores when the run is on the baseline branch', async () => {
    pushTo('main')

    await expect(restoreCache('/path/to/cache', 'cache-key'))
      .resolves
      .toEqual({ status: 'publishing', branch: 'main' })
    expect(cache.restoreCache).not.toHaveBeenCalled()
  })

  it('recognises a default branch that is not called main', async () => {
    pushTo('master', 'master')

    await expect(restoreCache('/path/to/cache', 'cache-key'))
      .resolves
      .toEqual({ status: 'publishing', branch: 'master' })
    expect(cache.restoreCache).not.toHaveBeenCalled()
  })

  it('still restores on a push to a branch that is not the baseline', async () => {
    vi.mocked(cache.restoreCache).mockResolvedValue('cache-key-main-123')
    pushTo('some-feature')

    await expect(restoreCache('/path/to/cache', 'cache-key'))
      .resolves
      .toEqual({ status: 'restored', key: 'cache-key-main-123' })
  })

  it('reports missing when no baseline branch can be determined', async () => {
    Object.assign(github.context, { ref: 'refs/heads/x', eventName: 'push', payload: {} })

    await expect(restoreCache('/path/to/cache', 'cache-key'))
      .resolves
      .toEqual({ status: 'missing' })
    expect(cache.restoreCache).not.toHaveBeenCalled()
  })
})

describe('saveCache', () => {
  beforeEach(() => {
    vi.mocked(core.info).mockImplementation(() => {})
  })

  it('saves on the default branch, keyed by branch and commit', async () => {
    vi.mocked(cache.saveCache).mockResolvedValue(0)
    pushTo('main')

    await saveCache('/path/to/cache', 'cache-key')

    expect(cache.saveCache).toHaveBeenCalledWith(['/path/to/cache'], 'cache-key-main-abc123')
  })

  it('saves when the default branch is not called main', async () => {
    vi.mocked(cache.saveCache).mockResolvedValue(0)
    pushTo('master', 'master')

    await saveCache('/path/to/cache', 'cache-key')

    expect(cache.saveCache).toHaveBeenCalledWith(['/path/to/cache'], 'cache-key-master-abc123')
  })

  it('flattens the separators a branch name may hold', async () => {
    vi.mocked(cache.saveCache).mockResolvedValue(0)
    pushTo('release/v2', 'release/v2')

    await saveCache('/path/to/cache', 'cache-key')

    expect(cache.saveCache).toHaveBeenCalledWith(['/path/to/cache'], 'cache-key-release-v2-abc123')
  })

  it('handles a save failure gracefully', async () => {
    vi.mocked(cache.saveCache).mockRejectedValue(new Error('Cache save failed'))
    vi.mocked(core.warning).mockImplementation(() => {})
    pushTo('main')

    await saveCache('/path/to/cache', 'cache-key')

    expect(core.warning).toHaveBeenCalledWith('Failed to save baseline cache: Cache save failed')
  })

  it('does not save from a pull request', async () => {
    pullRequestInto('main')

    await saveCache('/path/to/cache', 'cache-key')

    expect(cache.saveCache).not.toHaveBeenCalled()
  })
})
