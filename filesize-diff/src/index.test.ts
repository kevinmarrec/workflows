import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import * as core from '@actions/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { saveStats } from './cache'
import {
  analyzeDirectory,
  ASSET_FOLDERS,
  baselineNote,
  buildRows,
  fileGroup,
  type FileStat,
  formatDiff,
  formatTotalRow,
  generateSection,
  generateTotalTable,
  getFileStats,
  groupRows,
  normalizeAssetFilename,
} from './index'

vi.mock('@actions/core')

describe('normalizeAssetFilename', () => {
  it.each(ASSET_FOLDERS)('should normalize Vite hashed filenames in %s folder', (folder) => {
    expect(normalizeAssetFilename(`${folder}/app-Ckdnwnhq.js`)).toBe(`${folder}/app.js`) // 8 chars
    expect(normalizeAssetFilename(`${folder}/asset-abc-defg.js`)).toBe(`${folder}/asset.js`) // 8 chars with hyphens
    expect(normalizeAssetFilename(`${folder}/file-abc_defg.js`)).toBe(`${folder}/file.js`) // 8 chars with underscores
    expect(normalizeAssetFilename(`${folder}/bundle-AbC-dEfGh.js`)).toBe(`${folder}/bundle.js`) // 9 chars
    expect(normalizeAssetFilename(`${folder}/script-12-34_567.js`)).toBe(`${folder}/script.js`) // 10 chars
  })

  // Vike separates the hash with a dot, Vite with a dash. Missing the dotted form left every entry
  // reading as deleted-and-recreated on any rebuild that changed its hash.
  it.each(ASSET_FOLDERS)('should normalize dot-separated hashes in %s folder', (folder) => {
    expect(normalizeAssetFilename(`${folder}/entry-client-routing.CHIDzETC.js`))
      .toBe(`${folder}/entry-client-routing.js`)
    expect(normalizeAssetFilename(`${folder}/src_pages_index.77wXnlLn.js`))
      .toBe(`${folder}/src_pages_index.js`)
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

  it('should leave unhashed names in asset folders alone', () => {
    expect(normalizeAssetFilename('assets/index.html')).toBe('assets/index.html')
    expect(normalizeAssetFilename('assets/index.pageContext.json')).toBe('assets/index.pageContext.json')
  })
})

describe('fileGroup', () => {
  it('groups by extension, lowercased', () => {
    expect(fileGroup('client/assets/app.js')).toBe('js')
    expect(fileGroup('client/INDEX.HTML')).toBe('html')
    expect(fileGroup('index.pageContext.json')).toBe('json')
  })

  it('gives an extension-less file its own name, since it shares a type with nothing', () => {
    expect(fileGroup('api')).toBe('api')
    expect(fileGroup('bin/server')).toBe('server')
  })

  it('treats a leading dot as a name, not an extension', () => {
    expect(fileGroup('.gitkeep')).toBe('.gitkeep')
  })
})

describe('groupRows', () => {
  it('sums each extension and orders by head size, largest first', () => {
    const rows = groupRows([
      { label: 'a.js', group: 'js', base: 10, head: 20 },
      { label: 'b.js', group: 'js', base: 10, head: 20 },
      { label: 'a.css', group: 'css', base: 100, head: 100 },
    ])

    expect(rows).toEqual([
      { group: 'css', label: '`css`', base: 100, head: 100 },
      { group: 'js', label: '`js`', base: 20, head: 40 },
    ])
  })

  it('breaks ties on the group name, so the order is stable across runs', () => {
    const rows = groupRows([
      { label: 'a.svg', group: 'svg', base: 0, head: 10 },
      { label: 'a.css', group: 'css', base: 0, head: 10 },
    ])

    expect(rows.map(row => row.group)).toEqual(['css', 'svg'])
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

describe('baselineNote', () => {
  it('adds nothing when the comparison is real', () => {
    expect(baselineNote({ status: 'restored', key: 'build-stats-main-abc123' })).toBe('')
  })

  it('says which branch has no baseline, so the table is not read as a diff', () => {
    const note = baselineNote({ status: 'missing', branch: 'main' })

    expect(note).toContain('No baseline for `main`')
    expect(note).toContain('without a comparison')
  })

  it('mentions eviction, since that is the reason a baseline goes missing on a live branch', () => {
    expect(baselineNote({ status: 'missing', branch: 'main' })).toMatch(/7 days/)
  })

  it('reports the branch being undeterminable as its own case', () => {
    const note = baselineNote({ status: 'missing' })

    expect(note).toContain('could not be determined')
    expect(note).not.toContain('undefined')
  })

  it('explains that the baseline branch has nothing to compare against', () => {
    expect(baselineNote({ status: 'publishing', branch: 'master' }))
      .toContain('Publishing the baseline for `master`')
  })
})

describe('buildRows', () => {
  it('labels a merged entry with how many files it covers', () => {
    const rows = buildRows([{ file: 'assets/chunk.js', size: 300, count: 3 }], null)

    expect(rows[0].label).toBe('assets/chunk.js (×3)')
    expect(rows[0].head).toBe(300)
  })

  it('leaves a single file unadorned', () => {
    expect(buildRows([{ file: 'app.js', size: 10, count: 1 }], null)[0].label).toBe('app.js')
  })

  it('reads a baseline written before counts existed as one file per entry', () => {
    expect(buildRows([{ file: 'app.js', size: 10 }], null)[0].label).toBe('app.js')
  })

  it('keeps a file present only in the baseline, at head size 0', () => {
    const rows = buildRows([], [{ file: 'gone.js', size: 40 }])

    expect(rows).toEqual([{ label: 'gone.js', group: 'js', base: 40, head: 0 }])
  })
})

describe('generateSection', () => {
  const current: FileStat[] = [
    { file: 'assets/bundle.js', size: 200 },
    { file: 'index.html', size: 150 },
    { file: 'style.css', size: 400 },
  ]

  it('leads with a type table ordered by size, then folds the file list away', () => {
    const { section } = generateSection('dist', current, null)

    expect(section).toContain('### dist')
    expect(section.indexOf('`css`')).toBeLessThan(section.indexOf('`js`'))
    expect(section.indexOf('`js`')).toBeLessThan(section.indexOf('`html`'))
    expect(section).toContain('<summary>3 entries</summary>')
    expect(section).toContain('assets/bundle.js')
  })

  it('drops the type table when one type would restate the directory total', () => {
    const { section } = generateSection('api/dist', [{ file: 'api', size: 100 }], null)

    expect(section).not.toContain('| Type |')
    expect(section).toContain('<summary>1 entry</summary>')
    expect(section).toContain('| api |')
  })

  it('sorts files by their type, so the list reads in the order the type table does', () => {
    const { section } = generateSection('dist', current, null)

    expect(section.indexOf('style.css')).toBeLessThan(section.indexOf('assets/bundle.js'))
    expect(section.indexOf('assets/bundle.js')).toBeLessThan(section.indexOf('index.html'))
  })

  it('reports the directory total for the summary table', () => {
    const { totalRow } = generateSection('dist', current, null)

    expect(totalRow).toContain('**dist**')
    expect(totalRow).toContain('750 B')
  })

  it('treats a missing baseline as unreviewed rather than unchanged', () => {
    expect(generateSection('dist', current, null).hasChanges).toBe(true)
  })

  it('reports no changes when every size matches the baseline', () => {
    expect(generateSection('dist', current, current).hasChanges).toBe(false)
  })

  it('reports changes when a single size moves', () => {
    const cached = [...current.slice(0, 2), { file: 'style.css', size: 399 }]

    expect(generateSection('dist', current, cached).hasChanges).toBe(true)
  })

  it('shows both columns and a delta once a baseline exists', () => {
    const { section } = generateSection('dist', current, current)

    expect(section).toContain('Base (Before Merge)')
    expect(section).toContain('Head (After Merge)')
    expect(section).toContain('Delta')
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

  it('should get file stats with normalization', async () => {
    expect(await getFileStats(tempDir)).toEqual([])

    fs.mkdirSync(path.join(tempDir, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'assets', 'app-Ckdnwnhq.js'), 'test')
    fs.writeFileSync(path.join(tempDir, 'assets', 'bundle.js'), 'bundle')
    fs.writeFileSync(path.join(tempDir, 'index.html'), 'html')

    const result = await getFileStats(tempDir)
    expect(result.find(r => r.file === 'assets/app.js')).toBeDefined()
    expect(result.find(r => r.file === 'assets/bundle.js')).toBeDefined()
  })

  // A build emits several `chunk-<hash>.js`; keying them by their normalized name kept the last
  // and dropped the rest from the total, under-reporting the directory by the size of the others.
  it('sums files that normalize onto the same name, rather than keeping one', async () => {
    fs.mkdirSync(path.join(tempDir, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'assets', 'chunk-BT0_zZ72.js'), 'a'.repeat(30))
    fs.writeFileSync(path.join(tempDir, 'assets', 'chunk-DGZ1aNwa.js'), 'b'.repeat(12))
    fs.writeFileSync(path.join(tempDir, 'assets', 'chunk-sdhIr6cn.js'), 'c'.repeat(5))

    const result = await getFileStats(tempDir)

    expect(result).toEqual([{ file: 'assets/chunk.js', size: 47, count: 3 }])
  })

  it('leaves out what the ignore patterns match', async () => {
    fs.writeFileSync(path.join(tempDir, 'main.js'), 'js')
    fs.writeFileSync(path.join(tempDir, 'main.js.map'), 'map')

    const result = await getFileStats(tempDir, ['**/*.map'])

    expect(result.map(r => r.file)).toEqual(['main.js'])
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
    expect(result.section).toContain('test.js')
    expect(result.totalRow).toContain(tempDir)
  })

  it('should detect no changes when sizes match', async () => {
    fs.writeFileSync(path.join(tempDir, 'test.js'), 'content')
    const cachePath = path.join(cacheDir, 'cache.json')
    const fileSize = fs.statSync(path.join(tempDir, 'test.js')).size
    saveStats([{ file: 'test.js', size: fileSize }], cachePath)

    const result = await analyzeDirectory(tempDir, cachePath)
    expect(result.hasChanges).toBe(false)
    expect(result.totalRow).toContain(tempDir)
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
    expect(result.section).toContain('deleted.js')
    expect(result.totalRow).toContain(tempDir)

    // Test file exists only in current (not in cache)
    fs.writeFileSync(path.join(tempDir, 'new.js'), 'new')
    const result2 = await analyzeDirectory(tempDir, cachePath)
    expect(result2.hasChanges).toBe(true)
    expect(result2.section).toContain('new.js')
  })

  it('should handle invalid cache file', async () => {
    fs.writeFileSync(path.join(tempDir, 'test.js'), 'test')
    fs.writeFileSync(path.join(cacheDir, 'cache.json'), 'invalid json')

    const result = await analyzeDirectory(tempDir, path.join(cacheDir, 'cache.json'))
    expect(result.hasChanges).toBe(true)
    expect(result.totalRow).toContain(tempDir)
  })
})
