import * as fs from 'node:fs'

import * as core from '@actions/core'
import * as github from '@actions/github'
import { filesize } from 'filesize'
import { basename, dirname, join, normalize } from 'pathe'
import { glob } from 'tinyglobby'

import { loadCachedStats, restoreCache, saveCache, saveStats } from './cache'
import { commentOnPR } from './comment'

export interface FileStat {
  file: string
  size: number
}

const FILE_PRIORITY_SCORE = {
  ASSETS_PREFIX: 2,
  JS_EXTENSION: 1,
} as const

export function getFilePriority(file: string): number {
  let score = 0
  if (file.startsWith('assets/')) score += FILE_PRIORITY_SCORE.ASSETS_PREFIX
  if (file.endsWith('.js')) score += FILE_PRIORITY_SCORE.JS_EXTENSION
  return score
}

export function normalizeAssetFilename(file: string): string {
  // Normalize Vite build hashed asset filenames (e.g., asset-Ckdnwnhq.js -> asset.js)
  // Vite generates alphanumeric hashes (exactly 8 chars, a-z, A-Z, 0-9) in format: filename-[hash].ext
  return file.replace(/-[a-z0-9]{8}(\.[a-z]+)$/i, '$1')
}

export function sortFiles(files: string[]): string[] {
  return [...files].sort((a, b) => {
    const scoreDiff = getFilePriority(b) - getFilePriority(a)
    return scoreDiff !== 0 ? scoreDiff : a.localeCompare(b)
  })
}

export async function getFileStats(directory: string): Promise<FileStat[]> {
  const files = await glob(['**/*'], { cwd: directory })

  const fileStats: FileStat[] = files.map(file => ({
    file: normalizeAssetFilename(file),
    size: fs.statSync(join(directory, file)).size,
  }))

  fileStats.sort((a, b) => {
    const scoreDiff = getFilePriority(b.file) - getFilePriority(a.file)
    return scoreDiff !== 0 ? scoreDiff : a.file.localeCompare(b.file)
  })

  return fileStats
}

export function formatDiff(currentSize: number, cachedSize: number): string {
  if (cachedSize === 0) return '🆕'
  if (currentSize === 0) return '❌'

  const diffSize = currentSize - cachedSize
  if (diffSize === 0) return '➖'

  const diffPercent = ((diffSize / cachedSize) * 100).toFixed(2)
  const sign = diffSize > 0 ? '+' : ''
  const indicator = diffSize > 0 ? '🔺' : '✅'
  return `${sign}${filesize(diffSize)} (${sign}${diffPercent}%) ${indicator}`
}

export function formatTotalRow(
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

export function getSectionName(directory: string): string | null {
  // Normalize path using pathe for cross-platform compatibility
  const normalizedDir = normalize(directory)
  const dirName = basename(normalizedDir).toLowerCase()

  // Check if directory name is a common build output directory
  const buildDirs = ['dist', 'build', 'out']
  if (buildDirs.includes(dirName)) {
    // Get parent directory
    const parentPath = dirname(normalizedDir)

    // If parent is root (no meaningful parent), return null to skip header
    if (parentPath === '.' || parentPath === '/' || parentPath === normalizedDir) {
      return null
    }

    // Return parent directory name
    const parentName = basename(parentPath)
    return parentName.charAt(0).toUpperCase() + parentName.slice(1)
  }

  // Default: use directory name
  return dirName.charAt(0).toUpperCase() + dirName.slice(1)
}

export function generateDiffTable(
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

export async function analyzeDirectory(
  directory: string,
  options: {
    cachePath: string
    showTotal: boolean
  },
): Promise<{ markdown: string, hasChanges: boolean }> {
  const { cachePath, showTotal } = options

  // Check if directory exists
  if (!fs.existsSync(directory)) {
    core.setFailed(`Directory not found at ${directory}. Please ensure the directory exists before running this action.`)
    throw new Error(`Directory not found at ${directory}`)
  }

  const currentStats = await getFileStats(directory)

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

export async function run(): Promise<void> {
  try {
    const directoriesInput = core.getInput('directories', { required: true })
    const cachePathBase = core.getInput('cache-path') || '.github/cache/build-stats'
    const cacheKey = core.getInput('cache-key') || 'build-stats-main'
    const showTotal = core.getBooleanInput('show-total', { required: false }) ?? true
    const prComment = core.getBooleanInput('comment-on-pr', { required: false }) ?? true

    const directories = directoriesInput.split(',').map(d => d.trim()).filter(Boolean)

    if (directories.length === 0) {
      return core.setFailed('At least one directory must be provided')
    }

    await restoreCache(cachePathBase, cacheKey)

    const summaryParts: string[] = []
    let overallHasChanges = false

    for (const directory of directories) {
      // Use normalized directory path for cache filename to avoid collisions
      const cacheFileName = directory.replace(/\//g, '-').replace(/\\/g, '-')
      const cachePath = join(cachePathBase, `${cacheFileName}.json`)
      const sectionName = getSectionName(directory)

      core.info(`Analyzing ${directory}...`)

      const { markdown, hasChanges } = await analyzeDirectory(directory, {
        cachePath,
        showTotal,
      })

      if (hasChanges) {
        overallHasChanges = true
      }

      // Only add section header if sectionName is not null
      const sectionHeader = sectionName ? `## ${sectionName}\n\n` : ''
      summaryParts.push(`${sectionHeader}${markdown}`)
    }

    const fullSummary = summaryParts.join('\n\n')

    // Write to step summary
    core.summary.addRaw(fullSummary)
    await core.summary.write()

    core.startGroup('Full summary')
    core.info(fullSummary)
    core.endGroup()

    // Set output
    core.setOutput('has-changes', overallHasChanges.toString())

    core.info(`Detected changes ? ${overallHasChanges ? 'yes' : 'no'}`)

    // Comment on PR if there are changes and comment-on-pr is enabled
    if (overallHasChanges && github.context.eventName === 'pull_request' && prComment) {
      const fullSummaryWithTitle = `# File size Diff\n\n${fullSummary}`
      await commentOnPR(fullSummaryWithTitle)
    }

    // Save cache only on main branch (to create baseline for PR comparisons)
    await saveCache(cachePathBase, cacheKey)
  }
  catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
