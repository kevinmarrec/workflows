import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import * as core from '@actions/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { saveStats } from './cache'
import {
  analyzeDirectory,
  ASSET_FOLDERS,
  type FileStat,
  formatDiff,
  formatTotalRow,
  generateDiffTable,
  generateTotalTable,
  getFilePriority,
  getFileStats,
  normalizeAssetFilename,
  sortFiles,
} from './index'

vi.mock('@actions/core')

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
  it.each(ASSET_FOLDERS)('should normalize Vite hashed filenames in %s folder', (folder) => {
    expect(normalizeAssetFilename(`${folder}/app-Ckdnwnhq.js`)).toBe(`${folder}/app.js`) // 8 chars
    expect(normalizeAssetFilename(`${folder}/asset-abc-defg.js`)).toBe(`${folder}/asset.js`) // 8 chars with hyphens
    expect(normalizeAssetFilename(`${folder}/file-abc_defg.js`)).toBe(`${folder}/file.js`) // 8 chars with underscores
    expect(normalizeAssetFilename(`${folder}/bundle-AbC-dEfGh.js`)).toBe(`${folder}/bundle.js`) // 9 chars
    expect(normalizeAssetFilename(`${folder}/script-12-34_567.js`)).toBe(`${folder}/script.js`) // 10 chars
  })

  it('should normalize Vite hashed filenames in nested asset folders', () => {
    expect(normalizeAssetFilename('assets/nested/app-Ckdnwnhq.js')).toBe('assets/nested/app.js')
  })

  it('should not normalize files outside asset folders', () => {
    expect(normalizeAssetFilename('app-Ckdnwnhq.js')).toBe('app-Ckdnwnhq.js') // Not in asset folder
    expect(normalizeAssetFilename('file-abc12345.js')).toBe('file-abc12345.js') // Matches pattern but not in asset folder
    expect(normalizeAssetFilename('asset.js')).toBe('asset.js')
    expect(normalizeAssetFilename('file-abc123.js')).toBe('file-abc123.js')
    expect(normalizeAssetFilename('file-abc1234.js')).toBe('file-abc1234.js') // 7 chars
    expect(normalizeAssetFilename('file-abc12345678.js')).toBe('file-abc12345678.js') // 11 chars
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
    expect(formatTotalRow('Total', 1000, 0, false)).toContain('Total')
    expect(formatTotalRow('Total', 1000, 1000, true)).toContain('➖')
    expect(formatTotalRow('Total', 2000, 1000, true)).toContain('🔺')
    expect(formatTotalRow('Total', 500, 1000, true)).toContain('✅')
  })
})

describe('generateDiffTable', () => {
  it('should generate table without cache', () => {
    const current: FileStat[] = [{ file: 'index.html', size: 100 }]
    const result = generateDiffTable(current, null)
    const joined = result.join('\n')
    expect(joined).toContain('File')
    expect(joined).toContain('index.html')
    expect(joined).toContain('**Total**')
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
    const joined = result.join('\n')
    expect(joined).toContain('Base (Before Merge)')
    expect(joined).toContain('Head (After Merge)')
    expect(joined).toContain('Delta')
    expect(joined).toContain('**Total**')
    expect(joined.indexOf('assets/bundle.js')).toBeLessThan(joined.indexOf('index.html'))
  })
})

describe('generateTotalTable', () => {
  it('should return empty string for empty array', () => {
    expect(generateTotalTable([])).toBe('')
  })

  it('should generate table without cache', () => {
    const totalRows = ['| **dir1** | **100 B** |']
    const result = generateTotalTable(totalRows)
    expect(result).toContain('Directory')
    expect(result).toContain('Size')
    expect(result).toContain('dir1')
  })

  it('should generate table with cache', () => {
    const totalRows = ['| **dir1** | **50 B** | **100 B** | +50 B 🔺 |']
    const result = generateTotalTable(totalRows)
    expect(result).toContain('Directory')
    expect(result).toContain('Base (Before Merge)')
    expect(result).toContain('Head (After Merge)')
    expect(result).toContain('Delta')
    expect(result).toContain('dir1')
  })

  it('should handle multiple rows', () => {
    const totalRows = [
      '| **dir1** | **100 B** |',
      '| **dir2** | **200 B** |',
    ]
    const result = generateTotalTable(totalRows)
    expect(result).toContain('dir1')
    expect(result).toContain('dir2')
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

    fs.mkdirSync(path.join(tempDir, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'assets', 'app-Ckdnwnhq.js'), 'test')
    fs.writeFileSync(path.join(tempDir, 'assets', 'bundle.js'), 'bundle')
    fs.writeFileSync(path.join(tempDir, 'index.html'), 'html')

    const result = await getFileStats(tempDir)
    expect(result[0].file).toBe('assets/app.js') // Sorted alphabetically after normalization
    expect(result.find(r => r.file === 'assets/bundle.js')).toBeDefined()
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
    vi.mocked(core.setFailed).mockImplementation(() => {})
    await expect(
      analyzeDirectory(path.join(tempDir, 'nonexistent'), path.join(cacheDir, 'cache.json')),
    ).rejects.toThrow()
  })

  it('should detect changes when no cache exists', async () => {
    fs.writeFileSync(path.join(tempDir, 'test.js'), 'test')
    const result = await analyzeDirectory(tempDir, path.join(cacheDir, 'cache.json'))
    expect(result.hasChanges).toBe(true)
    const markdown = result.tableRows.join('\n')
    expect(markdown).toContain('test.js')
    expect(markdown).toContain('**Total**')
  })

  it('should detect no changes when sizes match', async () => {
    fs.writeFileSync(path.join(tempDir, 'test.js'), 'content')
    const cachePath = path.join(cacheDir, 'cache.json')
    const fileSize = fs.statSync(path.join(tempDir, 'test.js')).size
    saveStats([{ file: 'test.js', size: fileSize }], cachePath)

    const result = await analyzeDirectory(tempDir, cachePath)
    expect(result.hasChanges).toBe(false)
    const markdown = result.tableRows.join('\n')
    expect(markdown).toContain('**Total**')
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
    const markdown = result.tableRows.join('\n')
    expect(markdown).toContain('deleted.js')
    expect(markdown).toContain('**Total**')

    // Test file exists only in current (not in cache)
    fs.writeFileSync(path.join(tempDir, 'new.js'), 'new')
    const result2 = await analyzeDirectory(tempDir, cachePath)
    expect(result2.hasChanges).toBe(true)
    const markdown2 = result2.tableRows.join('\n')
    expect(markdown2).toContain('new.js')
    expect(markdown2).toContain('**Total**')
  })

  it('should handle invalid cache file', async () => {
    fs.writeFileSync(path.join(tempDir, 'test.js'), 'test')
    fs.writeFileSync(path.join(cacheDir, 'cache.json'), 'invalid json')

    const result = await analyzeDirectory(tempDir, path.join(cacheDir, 'cache.json'))
    expect(result.hasChanges).toBe(true)
    const markdown = result.tableRows.join('\n')
    expect(markdown).toContain('**Total**')
  })
})
