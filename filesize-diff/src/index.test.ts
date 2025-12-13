import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import * as core from '@actions/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { saveStats } from './cache'
import {
  analyzeDirectory,
  type FileStat,
  formatDiff,
  formatTotalRow,
  generateDiffTable,
  getFilePriority,
  getFileStats,
  normalizeAssetFilename,
  sortFiles,
} from './index'

describe('getFilePriority', () => {
  it('should return 0 for regular files', () => {
    expect(getFilePriority('index.html')).toBe(0)
  })

  it('should add priority for assets prefix and js extension', () => {
    expect(getFilePriority('assets/image.png')).toBe(2)
    expect(getFilePriority('script.js')).toBe(1)
    expect(getFilePriority('assets/bundle.js')).toBe(3)
  })
})

describe('normalizeAssetFilename', () => {
  it('should normalize Vite hashed filenames', () => {
    expect(normalizeAssetFilename('app-Ckdnwnhq.js')).toBe('app.js')
    expect(normalizeAssetFilename('my-asset-abc12345.js')).toBe('my-asset.js')
  })

  it('should not modify non-Vite-hashed filenames', () => {
    expect(normalizeAssetFilename('asset.js')).toBe('asset.js')
    expect(normalizeAssetFilename('file-abc123.js')).toBe('file-abc123.js')
  })
})

describe('sortFiles', () => {
  it('should sort by priority then alphabetically', () => {
    const files = ['index.html', 'assets/bundle.js', 'script.js', 'assets/image.png']
    const sorted = sortFiles(files)
    expect(sorted).toEqual(['assets/bundle.js', 'assets/image.png', 'script.js', 'index.html'])
  })

  it('should sort alphabetically when priorities are equal', () => {
    const files = ['z.js', 'a.js', 'm.js']
    const sorted = sortFiles(files)
    expect(sorted).toEqual(['a.js', 'm.js', 'z.js'])
  })
})

describe('formatDiff', () => {
  it('should format all diff types', () => {
    expect(formatDiff(100, 0)).toBe('🆕')
    expect(formatDiff(0, 100)).toBe('❌')
    expect(formatDiff(100, 100)).toBe('➖')
    expect(formatDiff(200, 100)).toContain('+')
    expect(formatDiff(50, 100)).toContain('✅')
  })
})

describe('formatTotalRow', () => {
  it('should format all total row variants', () => {
    expect(formatTotalRow(1000, 0, false)).toContain('Total')
    expect(formatTotalRow(1000, 1000, true)).toContain('➖')
    expect(formatTotalRow(2000, 1000, true)).toContain('🔺')
    expect(formatTotalRow(500, 1000, true)).toContain('✅')
  })
})

describe('generateDiffTable', () => {
  it('should generate table without cache', () => {
    const current: FileStat[] = [{ file: 'index.html', size: 100 }]
    const result = generateDiffTable(current, null)
    expect(result).toContain('File')
    expect(result).toContain('index.html')
    expect(result).toContain('**Total**')
  })

  it('should generate table with cache and sort by priority', () => {
    const current: FileStat[] = [
      { file: 'index.html', size: 150 },
      { file: 'assets/bundle.js', size: 200 },
    ]
    const cached: FileStat[] = [
      { file: 'index.html', size: 100 },
      { file: 'assets/bundle.js', size: 200 },
    ]
    const result = generateDiffTable(current, cached)
    expect(result).toContain('main')
    expect(result).toContain('**Total**')
    expect(result.indexOf('assets/bundle.js')).toBeLessThan(result.indexOf('index.html'))
  })
})

describe('getFileStats', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should get file stats with normalization and sorting', async () => {
    expect(await getFileStats(tempDir)).toEqual([])

    fs.writeFileSync(path.join(tempDir, 'app-Ckdnwnhq.js'), 'test')
    fs.mkdirSync(path.join(tempDir, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'assets', 'bundle.js'), 'bundle')
    fs.writeFileSync(path.join(tempDir, 'index.html'), 'html')

    const result = await getFileStats(tempDir)
    expect(result[0].file).toBe('assets/bundle.js')
    expect(result.find(r => r.file === 'app.js')).toBeDefined()
  })
})

describe('analyzeDirectory', () => {
  let tempDir: string
  let cacheDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'))
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })

  it('should throw error if directory does not exist', async () => {
    vi.spyOn(core, 'setFailed').mockImplementation(() => {})
    await expect(
      analyzeDirectory(path.join(tempDir, 'nonexistent'), path.join(cacheDir, 'cache.json')),
    ).rejects.toThrow()
  })

  it('should detect changes when no cache exists', async () => {
    fs.writeFileSync(path.join(tempDir, 'test.js'), 'test')
    const result = await analyzeDirectory(tempDir, path.join(cacheDir, 'cache.json'))
    expect(result.hasChanges).toBe(true)
    expect(result.markdown).toContain('test.js')
    expect(result.markdown).toContain('**Total**')
  })

  it('should detect no changes when sizes match', async () => {
    fs.writeFileSync(path.join(tempDir, 'test.js'), 'content')
    const cachePath = path.join(cacheDir, 'cache.json')
    const fileSize = fs.statSync(path.join(tempDir, 'test.js')).size
    saveStats([{ file: 'test.js', size: fileSize }], cachePath)

    const result = await analyzeDirectory(tempDir, cachePath)
    expect(result.hasChanges).toBe(false)
    expect(result.markdown).toContain('**Total**')
  })

  it('should detect changes when file exists only in cache or only in current', async () => {
    fs.writeFileSync(path.join(tempDir, 'remaining.js'), 'content')
    const cachePath = path.join(cacheDir, 'cache.json')
    saveStats(
      [
        { file: 'remaining.js', size: 7 },
        { file: 'deleted.js', size: 10 },
      ],
      cachePath,
    )

    const result = await analyzeDirectory(tempDir, cachePath)
    expect(result.hasChanges).toBe(true)
    expect(result.markdown).toContain('deleted.js')
    expect(result.markdown).toContain('**Total**')

    // Test file exists only in current (not in cache)
    fs.writeFileSync(path.join(tempDir, 'new.js'), 'new')
    const result2 = await analyzeDirectory(tempDir, cachePath)
    expect(result2.hasChanges).toBe(true)
    expect(result2.markdown).toContain('new.js')
    expect(result2.markdown).toContain('**Total**')
  })

  it('should handle invalid cache file', async () => {
    fs.writeFileSync(path.join(tempDir, 'test.js'), 'test')
    fs.writeFileSync(path.join(cacheDir, 'cache.json'), 'invalid json')

    const result = await analyzeDirectory(tempDir, path.join(cacheDir, 'cache.json'))
    expect(result.hasChanges).toBe(true)
    expect(result.markdown).toContain('**Total**')
  })
})
