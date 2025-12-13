import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadCachedStats, restoreCache, saveCache, saveStats } from './cache'
import type { FileStat } from './index'

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

describe('restoreCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should restore cache on non-main branches', async () => {
    const mockRestoreCache = vi.fn().mockResolvedValue('cache-key-123')
    vi.spyOn(cache, 'restoreCache').mockImplementation(mockRestoreCache)
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      ref: 'refs/heads/feature-branch',
    } as any)

    const result = await restoreCache('/path/to/cache', 'cache-key')
    expect(result).toBe('cache-key-123')
    expect(mockRestoreCache).toHaveBeenCalledWith(
      ['/path/to/cache'],
      'cache-key',
      ['cache-key-'],
    )
    expect(core.info).toHaveBeenCalledWith('Restoring cache with restore key pattern: cache-key-')
    expect(core.info).toHaveBeenCalledWith('Cache restored from key: cache-key-123')
  })

  it('should return undefined when no cache found on non-main branches', async () => {
    vi.spyOn(cache, 'restoreCache').mockResolvedValue(undefined)
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      ref: 'refs/heads/feature-branch',
    } as any)

    const result = await restoreCache('/path/to/cache', 'cache-key')
    expect(result).toBeUndefined()
    expect(core.info).toHaveBeenCalledWith('No cache found')
  })

  it('should skip restore on main branch', async () => {
    vi.spyOn(cache, 'restoreCache').mockResolvedValue(undefined)
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      ref: 'refs/heads/main',
    } as any)

    const result = await restoreCache('/path/to/cache', 'cache-key')
    expect(result).toBeUndefined()
    expect(cache.restoreCache).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith('Skipping cache restore on main branch (no comparison needed)')
  })
})

describe('saveCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should save cache on main branch', async () => {
    const mockSaveCache = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(cache, 'saveCache').mockImplementation(mockSaveCache)
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      ref: 'refs/heads/main',
      sha: 'abc123',
    } as any)

    await saveCache('/path/to/cache', 'cache-key')
    expect(mockSaveCache).toHaveBeenCalledWith(['/path/to/cache'], 'cache-key-abc123')
    expect(core.info).toHaveBeenCalledWith('Attempting to save baseline cache with key: cache-key-abc123')
    expect(core.info).toHaveBeenCalledWith('Baseline cache saved successfully (Cache reserved and uploaded)')
  })

  it('should handle save cache errors gracefully', async () => {
    vi.spyOn(cache, 'saveCache').mockRejectedValue(new Error('Cache save failed'))
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(core, 'warning').mockImplementation(() => {})
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      ref: 'refs/heads/main',
      sha: 'abc123',
    } as any)

    await saveCache('/path/to/cache', 'cache-key')
    expect(core.warning).toHaveBeenCalledWith('Failed to save baseline cache: Cache save failed')
  })

  it('should skip save on non-main branches', async () => {
    const mockSaveCache = vi.spyOn(cache, 'saveCache')
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      ref: 'refs/heads/feature-branch',
    } as any)

    await saveCache('/path/to/cache', 'cache-key')
    expect(mockSaveCache).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith('Skipping baseline cache save (not on main branch)')
  })
})
