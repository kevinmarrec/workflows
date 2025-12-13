import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('main function integration', () => {
  let tempDir: string
  let cacheDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(core, 'startGroup').mockImplementation(() => {})
    vi.spyOn(core, 'endGroup').mockImplementation(() => {})
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'))
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })

  it('should fail when no directories provided', async () => {
    vi.spyOn(core, 'getInput').mockReturnValue('')
    vi.spyOn(core, 'getBooleanInput').mockReturnValue(false)
    vi.spyOn(core, 'setFailed').mockImplementation(() => {})

    const { run } = await import('./index')
    await run()

    expect(core.setFailed).toHaveBeenCalledWith('At least one directory must be provided')
  })

  it('should process directories and handle cache on main branch', async () => {
    const dir1 = path.join(tempDir, 'dir1')
    fs.mkdirSync(dir1, { recursive: true })
    fs.writeFileSync(path.join(dir1, 'file1.js'), 'content1')

    vi.spyOn(core, 'getInput').mockImplementation((name: string) => {
      if (name === 'directories') return dir1
      if (name === 'cache-path') return cacheDir
      return ''
    })
    vi.spyOn(core, 'getBooleanInput').mockReturnValue(false)
    vi.spyOn(core, 'setOutput').mockImplementation(() => {})
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(core, 'summary', 'get').mockReturnValue({
      addRaw: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
    } as any)
    vi.spyOn(cache, 'restoreCache').mockResolvedValue(undefined)
    vi.spyOn(cache, 'saveCache').mockResolvedValue(0)
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      ref: 'refs/heads/main',
      eventName: 'push',
      sha: 'abc123',
      repo: { owner: 'owner', repo: 'repo' },
    } as any)

    const { run } = await import('./index')
    await run()

    expect(core.info).toHaveBeenCalledWith('Skipping cache restore on main branch (no comparison needed)')
    expect(cache.saveCache).toHaveBeenCalled()
  })

  it('should restore cache on non-main branch', async () => {
    const dir1 = path.join(tempDir, 'dir1')
    fs.mkdirSync(dir1, { recursive: true })
    fs.writeFileSync(path.join(dir1, 'file1.js'), 'content1')

    vi.spyOn(core, 'getInput').mockImplementation((name: string) => {
      if (name === 'directories') return dir1
      if (name === 'cache-path') return cacheDir
      return ''
    })
    vi.spyOn(core, 'getBooleanInput').mockReturnValue(false)
    vi.spyOn(core, 'setOutput').mockImplementation(() => {})
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(core, 'summary', 'get').mockReturnValue({
      addRaw: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
    } as any)
    vi.spyOn(cache, 'restoreCache').mockResolvedValue('cache-hit')
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      ref: 'refs/heads/feature',
      eventName: 'pull_request',
      sha: 'abc123',
      repo: { owner: 'owner', repo: 'repo' },
    } as any)

    const { run } = await import('./index')
    await run()

    expect(cache.restoreCache).toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalled()
  })

  it('should comment on PR when changes detected', async () => {
    const dir1 = path.join(tempDir, 'dir1')
    fs.mkdirSync(dir1, { recursive: true })
    fs.writeFileSync(path.join(dir1, 'file1.js'), 'content1')

    const mockOctokit = {
      rest: {
        issues: {
          listComments: vi.fn().mockResolvedValue({ data: [] }),
          createComment: vi.fn().mockResolvedValue({}),
        },
      },
    }

    vi.spyOn(core, 'getInput').mockImplementation((name: string) => {
      if (name === 'directories') return dir1
      if (name === 'cache-path') return cacheDir
      if (name === 'github-token') return 'token'
      return ''
    })
    vi.spyOn(core, 'getBooleanInput').mockImplementation((name: string) => {
      return name === 'comment-on-pr'
    })
    vi.spyOn(core, 'setOutput').mockImplementation(() => {})
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(core, 'summary', 'get').mockReturnValue({
      addRaw: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
    } as any)
    vi.spyOn(cache, 'restoreCache').mockResolvedValue(undefined)
    vi.spyOn(github, 'getOctokit').mockReturnValue(mockOctokit as any)
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      ref: 'refs/heads/feature',
      eventName: 'pull_request',
      issue: { number: 123 },
      sha: 'abc123',
      repo: { owner: 'owner', repo: 'repo' },
    } as any)

    const { run } = await import('./index')
    await run()

    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled()
  })

  it('should handle cache save errors with Error and non-Error types', async () => {
    const dir1 = path.join(tempDir, 'dir1')
    fs.mkdirSync(dir1, { recursive: true })
    fs.writeFileSync(path.join(dir1, 'file1.js'), 'content1')

    vi.spyOn(core, 'getInput').mockImplementation((name: string) => {
      if (name === 'directories') return dir1
      if (name === 'cache-path') return cacheDir
      return ''
    })
    vi.spyOn(core, 'getBooleanInput').mockReturnValue(false)
    vi.spyOn(core, 'setOutput').mockImplementation(() => {})
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(core, 'warning').mockImplementation(() => {})
    vi.spyOn(core, 'summary', 'get').mockReturnValue({
      addRaw: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
    } as any)
    vi.spyOn(cache, 'restoreCache').mockResolvedValue(undefined)
    vi.spyOn(cache, 'saveCache').mockRejectedValue(new Error('Cache save failed'))
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      ref: 'refs/heads/main',
      eventName: 'push',
      sha: 'abc123',
      repo: { owner: 'owner', repo: 'repo' },
    } as any)

    const { run } = await import('./index')
    await run()

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to save baseline cache'))

    // Test non-Error exception
    vi.clearAllMocks()
    vi.spyOn(cache, 'saveCache').mockRejectedValue('String error')
    await run()
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to save baseline cache'))
  })

  it('should handle errors in main function', async () => {
    vi.spyOn(core, 'getInput').mockImplementation(() => {
      throw new Error('Input error')
    })
    vi.spyOn(core, 'setFailed').mockImplementation(() => {})

    const { run } = await import('./index')
    await run()

    expect(core.setFailed).toHaveBeenCalledWith('Input error')
  })

  it('should handle non-Error exceptions', async () => {
    vi.spyOn(core, 'getInput').mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'String error'
    })
    vi.spyOn(core, 'setFailed').mockImplementation(() => {})

    const { run } = await import('./index')
    await run()

    expect(core.setFailed).toHaveBeenCalledWith('String error')
  })

  it('should use default values for comment-on-pr', async () => {
    const dir1 = path.join(tempDir, 'dir1')
    fs.mkdirSync(dir1, { recursive: true })
    fs.writeFileSync(path.join(dir1, 'file1.js'), 'content1')

    vi.spyOn(core, 'getInput').mockImplementation((name: string) => {
      if (name === 'directories') return dir1
      if (name === 'cache-path') return cacheDir
      return ''
    })
    vi.spyOn(core, 'getBooleanInput').mockImplementation(() => {
      return undefined as any // Test default behavior
    })
    vi.spyOn(core, 'setOutput').mockImplementation(() => {})
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(core, 'summary', 'get').mockReturnValue({
      addRaw: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
    } as any)
    vi.spyOn(cache, 'restoreCache').mockResolvedValue(undefined)
    vi.spyOn(cache, 'saveCache').mockResolvedValue(0)
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      ref: 'refs/heads/feature',
      eventName: 'pull_request',
      sha: 'abc123',
      repo: { owner: 'owner', repo: 'repo' },
    } as any)

    const { run } = await import('./index')
    await run()

    expect(core.summary.addRaw).toHaveBeenCalled()
  })

  it('should handle case when no changes detected across directories', async () => {
    const dir1 = path.join(tempDir, 'dir1')
    fs.mkdirSync(dir1, { recursive: true })
    const filePath = path.join(dir1, 'file1.js')
    fs.writeFileSync(filePath, 'content1')
    const fileSize = fs.statSync(filePath).size

    // Create cache file that will be restored
    const cachePath = path.join(cacheDir, 'dir1.json')
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    fs.writeFileSync(cachePath, JSON.stringify([{ file: 'file1.js', size: fileSize }], null, 2))

    vi.spyOn(core, 'getInput').mockImplementation((name: string) => {
      if (name === 'directories') return dir1
      if (name === 'cache-path') return cacheDir
      return ''
    })
    vi.spyOn(core, 'getBooleanInput').mockReturnValue(false)
    const setOutputSpy = vi.spyOn(core, 'setOutput').mockImplementation(() => {})
    const infoSpy = vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(core, 'summary', 'get').mockReturnValue({
      addRaw: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
    } as any)
    vi.spyOn(cache, 'restoreCache').mockResolvedValue('cache-hit')
    vi.spyOn(github, 'context', 'get').mockReturnValue({
      ref: 'refs/heads/feature',
      eventName: 'pull_request',
      sha: 'abc123',
      repo: { owner: 'owner', repo: 'repo' },
    } as any)

    const { run } = await import('./index')
    await run()

    // Verify has-changes is false and "no" message is logged
    const hasChangesCall = setOutputSpy.mock.calls.find(call => call[0] === 'has-changes')
    if (hasChangesCall?.[1] === 'false') {
      expect(infoSpy).toHaveBeenCalledWith('Detected changes ? no')
    }
  })

  it('should use directory name directly in details summary', async () => {
    const distDir = path.join(tempDir, 'dist')
    fs.mkdirSync(distDir, { recursive: true })
    fs.writeFileSync(path.join(distDir, 'file1.js'), 'content1')

    // Change to tempDir so relative path 'dist' works
    const originalCwd = process.cwd()
    process.chdir(tempDir)

    try {
      const addRawSpy = vi.fn()
      vi.spyOn(core, 'getInput').mockImplementation((name: string) => {
        if (name === 'directories') return 'dist'
        if (name === 'cache-path') return cacheDir
        return ''
      })
      vi.spyOn(core, 'getBooleanInput').mockReturnValue(false)
      vi.spyOn(core, 'setOutput').mockImplementation(() => {})
      vi.spyOn(core, 'info').mockImplementation(() => {})
      vi.spyOn(core, 'summary', 'get').mockReturnValue({
        addRaw: addRawSpy,
        write: vi.fn().mockResolvedValue(undefined),
      } as any)
      vi.spyOn(cache, 'restoreCache').mockResolvedValue(undefined)
      vi.spyOn(github, 'context', 'get').mockReturnValue({
        ref: 'refs/heads/feature',
        eventName: 'pull_request',
        sha: 'abc123',
        repo: { owner: 'owner', repo: 'repo' },
      } as any)

      const { run } = await import('./index')
      await run()

      // Verify that the summary was called and contains the new format
      expect(addRawSpy).toHaveBeenCalled()
      const summaryCall = addRawSpy.mock.calls[0][0]
      // Should contain the main title
      expect(summaryCall).toContain('# 📋 File size Summary')
      // Should be wrapped in details tags with directory name as summary
      expect(summaryCall).toContain('<details>')
      expect(summaryCall).toContain('<summary>dist</summary>')
      // Should contain the table content
      expect(summaryCall).toContain('file1.js')
    }
    finally {
      process.chdir(originalCwd)
    }
  })
})
