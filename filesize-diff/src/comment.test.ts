import * as core from '@actions/core'
import * as github from '@actions/github'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { commentOnPR } from './comment'

vi.mock('@actions/core')
vi.mock('@actions/github', () => ({
  context: {
    eventName: '',
    issue: { number: 0 },
    repo: { owner: '', repo: '' },
  },
  getOctokit: vi.fn(),
}))

describe('commentOnPR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return early for non-PR events or missing PR number', async () => {
    vi.mocked(core.getInput).mockReturnValue('token')
    vi.mocked(github.getOctokit).mockReturnValue({ rest: { issues: {} } } as any)

    Object.assign(github.context, {
      eventName: 'push',
      issue: { number: 123 },
      repo: { owner: 'owner', repo: 'repo' },
    })
    await commentOnPR('body')
    expect(github.getOctokit).toHaveBeenCalled()

    vi.mocked(core.warning).mockImplementation(() => {})
    Object.assign(github.context, {
      eventName: 'pull_request',
      issue: { number: undefined },
      repo: { owner: 'owner', repo: 'repo' },
    })
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

    vi.mocked(core.getInput).mockReturnValue('token')
    vi.mocked(core.info).mockImplementation(() => {})
    vi.mocked(github.getOctokit).mockReturnValue(mockOctokit as any)
    Object.assign(github.context, {
      eventName: 'pull_request',
      issue: { number: 123 },
      repo: { owner: 'owner', repo: 'repo' },
    })

    await commentOnPR('body')
    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled()

    mockOctokit.rest.issues.listComments.mockResolvedValue({
      data: [{ id: 456, user: { type: 'Bot' }, body: '<!-- filesize-diff-action -->' }],
    })
    await commentOnPR('body')
    expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalled()
  })

  it('should handle errors gracefully', async () => {
    vi.mocked(core.getInput).mockReturnValue('token')
    vi.mocked(core.warning).mockImplementation(() => {})
    vi.mocked(github.getOctokit).mockReturnValue({
      rest: {
        issues: {
          listComments: vi.fn().mockRejectedValue(new Error('API error')),
        },
      },
    } as any)
    Object.assign(github.context, {
      eventName: 'pull_request',
      issue: { number: 123 },
      repo: { owner: 'owner', repo: 'repo' },
    })

    await commentOnPR('body')
    expect(core.warning).toHaveBeenCalled()
  })
})
