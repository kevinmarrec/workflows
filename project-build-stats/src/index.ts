import * as fs from 'node:fs'
import * as path from 'node:path'

import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { filesize } from 'filesize'
import { x } from 'tinyexec'
import { glob } from 'tinyglobby'

interface FileStat {
  file: string
  size: number
}

const FILE_PRIORITY_SCORE = {
  ASSETS_PREFIX: 2,
  JS_EXTENSION: 1,
} as const

function getFilePriority(file: string): number {
  let score = 0
  if (file.startsWith('assets/')) score += FILE_PRIORITY_SCORE.ASSETS_PREFIX
  if (file.endsWith('.js')) score += FILE_PRIORITY_SCORE.JS_EXTENSION
  return score
}

function normalizeAssetFilename(file: string): string {
  if (!file.startsWith('dist/assets/')) {
    return file
  }

  return file.replace(/-\S{8,}(\.[a-z]+)$/, '$1')
}

function sortFiles(files: string[]): string[] {
  return [...files].sort((a, b) => {
    const scoreDiff = getFilePriority(b) - getFilePriority(a)
    return scoreDiff !== 0 ? scoreDiff : a.localeCompare(b)
  })
}

async function getFileStats(directory: string): Promise<FileStat[]> {
  const files = await glob(['**/*'], { cwd: directory })

  const fileStats: FileStat[] = files.map(file => ({
    file: normalizeAssetFilename(`dist/${file}`),
    size: fs.statSync(path.join(directory, file)).size,
  }))

  fileStats.sort((a, b) => {
    const scoreDiff = getFilePriority(b.file) - getFilePriority(a.file)
    return scoreDiff !== 0 ? scoreDiff : a.file.localeCompare(b.file)
  })

  return fileStats
}

function loadCachedStats(cachePath: string): FileStat[] | null {
  if (!fs.existsSync(cachePath)) {
    return null
  }
  try {
    const content = fs.readFileSync(cachePath, 'utf-8')
    return JSON.parse(content)
  }
  catch {
    return null
  }
}

function saveStats(stats: FileStat[], cachePath: string): void {
  const dir = path.dirname(cachePath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(cachePath, JSON.stringify(stats, null, 2))
}

function formatDiff(currentSize: number, cachedSize: number): string {
  if (cachedSize === 0) return '🆕'
  if (currentSize === 0) return '❌'

  const diffSize = currentSize - cachedSize
  if (diffSize === 0) return '➖'

  const diffPercent = ((diffSize / cachedSize) * 100).toFixed(2)
  const sign = diffSize > 0 ? '+' : ''
  const indicator = diffSize > 0 ? '🔺' : '✅'
  return `${sign}${filesize(diffSize)} (${sign}${diffPercent}%) ${indicator}`
}

function formatTotalRow(
  totalCurrent: number,
  totalCached: number,
  hasCache: boolean,
): string {
  if (!hasCache) {
    return `| **Total** | **${filesize(totalCurrent)}** |`
  }

  const totalDiff = totalCurrent - totalCached
  const diffDisplay = totalDiff === 0
    ? '➖'
    : totalDiff > 0
      ? `+${filesize(totalDiff)} 🔺`
      : `${filesize(totalDiff)} ✅`

  return `| **Total** | **${filesize(totalCached)}** | **${filesize(totalCurrent)}** | ${diffDisplay} |`
}

function generateDiffTable(
  current: FileStat[],
  cached: FileStat[] | null,
  showTotal: boolean,
): string {
  const hasCache = cached !== null
  const currentMap = new Map(current.map(s => [s.file, s.size]))
  const cachedMap = hasCache ? new Map(cached.map(s => [s.file, s.size])) : new Map()

  const allFiles = new Set([...currentMap.keys(), ...cachedMap.keys()])
  const sortedFiles = sortFiles(Array.from(allFiles))

  const rows: string[] = []
  let totalCurrent = 0
  let totalCached = 0

  for (const file of sortedFiles) {
    const currentSize = currentMap.get(file) ?? 0
    const cachedSize = cachedMap.get(file) ?? 0
    totalCurrent += currentSize
    totalCached += cachedSize

    if (hasCache) {
      const diff = formatDiff(currentSize, cachedSize)
      rows.push(`| ${file} | ${filesize(cachedSize)} | ${filesize(currentSize)} | ${diff} |`)
    }
    else {
      rows.push(`| ${file} | ${filesize(currentSize)} |`)
    }
  }

  const header = hasCache
    ? `| File | \`main\` | Current | Diff |\n| :--- | ---: | ---: | ---: |`
    : '| File | Size |\n| :--- | ---: |'

  const table = [header, ...rows]

  if (showTotal) {
    table.push(formatTotalRow(totalCurrent, totalCached, hasCache))
  }

  return table.join('\n')
}

async function analyzeDirectory(
  directory: string,
  options: {
    cachePath: string
    showTotal: boolean
    packageManager: string
  },
): Promise<{ markdown: string, hasChanges: boolean }> {
  const { cachePath, showTotal, packageManager } = options
  // Build the project
  const buildCommand = packageManager === 'yarn'
    ? ['build']
    : ['run', 'build']
  const result = await x(packageManager, buildCommand, { nodeOptions: { cwd: directory } })

  if (result.exitCode !== 0) {
    const command = `${packageManager} ${buildCommand.join(' ')}`
    const errorOutput = result.stderr ? `\nError output:\n${result.stderr}` : ''
    core.setFailed(`Build failed in ${directory} with command "${command}". Exit code: ${result.exitCode ?? 'unknown'}.${errorOutput}`)
    throw new Error(`Build failed with exit code ${result.exitCode}`)
  }

  const distPath = path.join(directory, 'dist')
  const currentStats = await getFileStats(distPath)

  // Load cached stats
  let cachedStats: FileStat[] | null = null
  let hasChanges = false

  if (fs.existsSync(cachePath)) {
    cachedStats = loadCachedStats(cachePath)
    if (cachedStats) {
      // Check if there are changes
      const currentMap = new Map(currentStats.map(s => [s.file, s.size]))
      const cachedMap = new Map(cachedStats.map(s => [s.file, s.size]))
      const allFiles = new Set([...currentMap.keys(), ...cachedMap.keys()])

      for (const file of allFiles) {
        const currentSize = currentMap.get(file) ?? 0
        const cachedSize = cachedMap.get(file) ?? 0
        if (currentSize !== cachedSize) {
          hasChanges = true
          break
        }
      }
    }
    else {
      hasChanges = true // New cache file means changes
    }
  }
  else {
    hasChanges = true // No cache means changes
  }

  // Save current stats
  saveStats(currentStats, cachePath)

  const markdown = generateDiffTable(currentStats, cachedStats, showTotal)
  return { markdown, hasChanges }
}

async function commentOnPR(body: string): Promise<void> {
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
  const COMMENT_HINT = '<!-- project-build-stats-action -->'
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

async function main(): Promise<void> {
  try {
    const directoriesInput = core.getInput('directories', { required: true })
    const cachePathBase = core.getInput('cache-path') || '.github/cache/build-stats'
    const cacheKey = core.getInput('cache-key') || 'build-stats-main'
    const showTotal = core.getBooleanInput('show-total', { required: false }) ?? true
    const prComment = core.getBooleanInput('comment-on-pr', { required: false }) ?? true
    const packageManager = core.getInput('package-manager') || 'bun'

    // Validate package manager
    if (!['bun', 'pnpm', 'yarn', 'npm'].includes(packageManager)) {
      return core.setFailed(`Invalid package-manager: "${packageManager}". Must be one of: bun, pnpm, yarn, npm`)
    }

    const directories = directoriesInput.split(',').map(d => d.trim()).filter(Boolean)

    if (directories.length === 0) {
      return core.setFailed('At least one directory must be provided')
    }

    const isMainBranch = github.context.ref === 'refs/heads/main'

    // Restore cache only on non-main branches (for comparison)
    // On main branch, we skip restore since we're building the baseline
    let cacheHit: string | undefined
    if (!isMainBranch) {
      // Use restore key pattern to find the latest main branch cache
      const restoreKeyPattern = `${cacheKey}-`
      core.info(`Restoring cache with restore key pattern: ${restoreKeyPattern}`)
      cacheHit = await cache.restoreCache([cachePathBase], cacheKey, [restoreKeyPattern])
      if (cacheHit) {
        core.info(`Cache restored from key: ${cacheHit}`)
      }
      else {
        core.info('No cache found')
      }
    }
    else {
      core.info('Skipping cache restore on main branch (no comparison needed)')
    }

    const summaryParts: string[] = []
    let overallHasChanges = false

    for (const directory of directories) {
      const dirName = path.basename(directory)
      const cachePath = path.join(cachePathBase, `${dirName}.json`)

      core.info(`Analyzing ${directory}...`)

      const { markdown, hasChanges } = await analyzeDirectory(directory, {
        cachePath,
        showTotal,
        packageManager,
      })

      if (hasChanges) {
        overallHasChanges = true
      }

      summaryParts.push(`## ${dirName.charAt(0).toUpperCase() + dirName.slice(1)}\n\n${markdown}`)
    }

    const fullSummary = summaryParts.join('\n\n')

    // Write to step summary
    core.summary.addRaw(`# Project Build Stats\n\n${fullSummary}`)
    await core.summary.write()

    core.startGroup('Full summary')
    core.info(fullSummary)
    core.endGroup()

    // Set output
    core.setOutput('has-changes', overallHasChanges.toString())

    core.info(`Detected changes ? ${overallHasChanges ? 'yes' : 'no'}`)

    // Comment on PR if there are changes and comment-on-pr is enabled
    if (overallHasChanges && github.context.eventName === 'pull_request' && prComment) {
      await commentOnPR(fullSummary)
    }

    // Save cache only on main branch (to create baseline for PR comparisons)
    // Use unique key with commit SHA to ensure cache updates on each commit
    if (isMainBranch) {
      const actualCacheKey = `${cacheKey}-${github.context.sha}`
      core.info(`Attempting to save baseline cache with key: ${actualCacheKey}`)
      try {
        await cache.saveCache([cachePathBase], actualCacheKey)
        core.info('Baseline cache saved successfully (Cache reserved and uploaded)')
      }
      catch (error) {
        core.warning(`Failed to save baseline cache: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    else {
      core.info('Skipping baseline cache save (not on main branch)')
    }
  }
  catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

main()
