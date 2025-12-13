import * as core from '@actions/core'
import * as github from '@actions/github'

export async function commentOnPR(body: string): Promise<void> {
  const token = core.getInput('github-token', { required: true })
  const octokit = github.getOctokit(token)
  const context = github.context

  if (context.eventName !== 'pull_request') {
    return
  }

  const prNumber = context.issue.number
  if (!prNumber) {
    core.warning('Could not determine PR number')
    return
  }

  // Add a hint identifier to the comment body for detection
  const COMMENT_HINT = '<!-- filesize-diff-action -->'
  const commentBody = `${COMMENT_HINT}\n\n${body}`

  try {
    // Find existing comment by looking for the hint
    const { data: comments } = await octokit.rest.issues.listComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
    })

    const botComment = comments.find(
      comment => comment.user?.type === 'Bot' && comment.body?.includes(COMMENT_HINT),
    )

    if (botComment) {
      // Update existing comment
      await octokit.rest.issues.updateComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: botComment.id,
        body: commentBody,
      })
      core.info('Updated existing PR comment')
    }
    else {
      // Create new comment
      await octokit.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        body: commentBody,
      })
      core.info('Created new PR comment')
    }
  }
  catch (error) {
    core.warning(`Failed to comment on PR: ${error}`)
  }
}
