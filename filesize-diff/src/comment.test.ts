import * as core from '@actions/core'
import * as github from '@actions/github'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { commentOnPR } from './comment'

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
