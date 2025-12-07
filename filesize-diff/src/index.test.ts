import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import * as core from '@actions/core'
import * as github from '@actions/github'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  analyzeDirectory,
  commentOnPR,
  type FileStat,
  formatDiff,
  formatTotalRow,
  generateDiffTable,
  getFilePriority,
  getFileStats,
  loadCachedStats,
  normalizeAssetFilename,
  saveStats,
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
    const result = generateDiffTable(current, null, false)
    expect(result).toContain('File')
    expect(result).toContain('index.html')
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
    const result = generateDiffTable(current, cached, true)
    expect(result).toContain('main')
    expect(result).toContain('**Total**')
    expect(result.indexOf('assets/bundle.js')).toBeLessThan(result.indexOf('index.html'))
  })
})

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
      analyzeDirectory(path.join(tempDir, 'nonexistent'), {
        cachePath: path.join(cacheDir, 'cache.json'),
        showTotal: false,
      }),
    ).rejects.toThrow()
  })

  it('should detect changes when no cache exists', async () => {
    fs.writeFileSync(path.join(tempDir, 'test.js'), 'test')
    const result = await analyzeDirectory(tempDir, {
      cachePath: path.join(cacheDir, 'cache.json'),
      showTotal: false,
    })
    expect(result.hasChanges).toBe(true)
    expect(result.markdown).toContain('test.js')
  })

  it('should detect no changes when sizes match', async () => {
    fs.writeFileSync(path.join(tempDir, 'test.js'), 'content')
    const cachePath = path.join(cacheDir, 'cache.json')
    const fileSize = fs.statSync(path.join(tempDir, 'test.js')).size
    saveStats([{ file: 'test.js', size: fileSize }], cachePath)

    const result = await analyzeDirectory(tempDir, {
      cachePath,
      showTotal: false,
    })
    expect(result.hasChanges).toBe(false)
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

    const result = await analyzeDirectory(tempDir, {
      cachePath,
      showTotal: false,
    })
    expect(result.hasChanges).toBe(true)
    expect(result.markdown).toContain('deleted.js')

    // Test file exists only in current (not in cache)
    fs.writeFileSync(path.join(tempDir, 'new.js'), 'new')
    const result2 = await analyzeDirectory(tempDir, {
      cachePath,
      showTotal: false,
    })
    expect(result2.hasChanges).toBe(true)
    expect(result2.markdown).toContain('new.js')
  })

  it('should handle invalid cache file', async () => {
    fs.writeFileSync(path.join(tempDir, 'test.js'), 'test')
    fs.writeFileSync(path.join(cacheDir, 'cache.json'), 'invalid json')

    const result = await analyzeDirectory(tempDir, {
      cachePath: path.join(cacheDir, 'cache.json'),
      showTotal: true,
    })
    expect(result.hasChanges).toBe(true)
    expect(result.markdown).toContain('**Total**')
  })
})

describe('commentOnPR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return early for non-PR events or missing PR number', async () => {
    vi.spyOn(core, 'getInput').mockReturnValue('token')
    vi.spyOn(github, 'getOctokit').mockReturnValue({ rest: { issues: {} } } as any)

    vi.spyOn(github, 'context', 'get').mockReturnValue({
      eventName: 'push',
      issue: { number: 123 },
      repo: { owner: 'owner', repo: 'repo' },
    } as any)
    await commentOnPR('body')
    expect(github.getOctokit).toHaveBeenCalled()

    vi.spyOn(core, 'warning').mockImplementation(() => {})
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      eventName: 'pull_request',
      issue: { number: undefined },
      repo: { owner: 'owner', repo: 'repo' },
    } as any)
    await commentOnPR('body')
    expect(core.warning).toHaveBeenCalled()
  })

  it('should create or update PR comments', async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listComments: vi.fn().mockResolvedValue({ data: [] }),
          createComment: vi.fn().mockResolvedValue({}),
          updateComment: vi.fn().mockResolvedValue({}),
        },
      },
    }

    vi.spyOn(core, 'getInput').mockReturnValue('token')
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(github, 'getOctokit').mockReturnValue(mockOctokit as any)
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      eventName: 'pull_request',
      issue: { number: 123 },
      repo: { owner: 'owner', repo: 'repo' },
    } as any)

    await commentOnPR('body')
    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled()

    mockOctokit.rest.issues.listComments.mockResolvedValue({
      data: [{ id: 456, user: { type: 'Bot' }, body: '<!-- filesize-diff-action -->' }],
    })
    await commentOnPR('body')
    expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalled()
  })

  it('should handle errors gracefully', async () => {
    vi.spyOn(core, 'getInput').mockReturnValue('token')
    vi.spyOn(core, 'warning').mockImplementation(() => {})
    vi.spyOn(github, 'getOctokit').mockReturnValue({
      rest: {
        issues: {
          listComments: vi.fn().mockRejectedValue(new Error('API error')),
        },
      },
    } as any)
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      eventName: 'pull_request',
      issue: { number: 123 },
      repo: { owner: 'owner', repo: 'repo' },
    } as any)

    await commentOnPR('body')
    expect(core.warning).toHaveBeenCalled()
  })
})
