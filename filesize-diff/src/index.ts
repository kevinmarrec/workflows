import * as fs from 'node:fs'

import * as core from '@actions/core'
import * as github from '@actions/github'
import { filesize } from 'filesize'
import { join } from 'pathe'
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

const COLUMN_HEADERS = {
  BASE: 'Base (Before Merge)',
  HEAD: 'Head (After Merge)',
  DELTA: 'Delta',
} as const

export function getFilePriority(file: string): number {
  let score = 0
  if (file.startsWith('assets/')) score += FILE_PRIORITY_SCORE.ASSETS_PREFIX
  if (file.endsWith('.js')) score += FILE_PRIORITY_SCORE.JS_EXTENSION
  return score
}

export function normalizeAssetFilename(file: string): string {
  // Normalize Vite build hashed asset filenames (e.g., asset-Ckdnwnhq.js -> asset.js)
  // Vite generates url-safe base64 hashes (8-10 chars, a-z, A-Z, 0-9, -, _) in format: filename-[hash].ext
  return file.replace(/-[\w-]{8,10}(\.[a-z]+)$/i, '$1')
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
  label: string,
  totalCurrent: number,
  totalCached: number,
  hasCache: boolean,
): string {
  if (!hasCache) {
    return `| **${label}** | **${filesize(totalCurrent)}** |`
  }

  const totalDiff = totalCurrent - totalCached
  const diffDisplay = totalDiff === 0
    ? '➖'
    : totalDiff > 0
      ? `+${filesize(totalDiff)} 🔺`
      : `${filesize(totalDiff)} ✅`

  return `| **${label}** | **${filesize(totalCached)}** | **${filesize(totalCurrent)}** | ${diffDisplay} |`
}

export function generateTotalTable(
  totalRows: string[],
): string {
  if (totalRows.length === 0) {
    return ''
  }

  // Determine table format from first row (check if it has 4 columns with cache or 2 without)
  const hasCache = totalRows[0].split('|').length === 6 // 4 columns + 2 empty at start/end

  const header = hasCache
    ? `| Directory | ${COLUMN_HEADERS.BASE} | ${COLUMN_HEADERS.HEAD} | ${COLUMN_HEADERS.DELTA} |\n| :--- | ---: | ---: | ---: |`
    : '| Directory | Size |\n| :--- | ---: |'

  return [header, ...totalRows].join('\n')
}

export function generateDiffTable(
  current: FileStat[],
  cached: FileStat[] | null,
): string[] {
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
    ? `| File | ${COLUMN_HEADERS.BASE} | ${COLUMN_HEADERS.HEAD} | ${COLUMN_HEADERS.DELTA} |\n| :--- | ---: | ---: | ---: |`
    : '| File | Size |\n| :--- | ---: |'

  const table = [header, ...rows]
  table.push(formatTotalRow('Total', totalCurrent, totalCached, hasCache))

  return table
}

export async function analyzeDirectory(
  directory: string,
  cachePath: string,
): Promise<{ tableRows: string[], hasChanges: boolean }> {
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

  const tableRows = generateDiffTable(currentStats, cachedStats)
  return { tableRows, hasChanges }
}

export async function run(): Promise<void> {
  try {
    const directoriesInput = core.getInput('directories', { required: true })
    const cachePathBase = core.getInput('cache-path') || '.github/cache/build-stats'
    const cacheKey = core.getInput('cache-key') || 'build-stats-main'
    const prComment = core.getBooleanInput('comment-on-pr', { required: false }) ?? true

    const directories = directoriesInput.split(',').map(d => d.trim()).filter(Boolean)

    if (directories.length === 0) {
      return core.setFailed('At least one directory must be provided')
    }

    await restoreCache(cachePathBase, cacheKey)

    const detailsSections: string[] = []
    const totalRows: string[] = []
    let overallHasChanges = false

    for (const directory of directories) {
      // Use normalized directory path for cache filename to avoid collisions
      const cacheFileName = directory.replace(/[\\/]/g, '-')
      const cachePath = join(cachePathBase, `${cacheFileName}.json`)

      core.info(`Analyzing ${directory}...`)

      const { tableRows, hasChanges } = await analyzeDirectory(directory, cachePath)

      if (hasChanges) {
        overallHasChanges = true
      }

      // Extract last row (total row) and replace "Total" with directory name
      const lastRow = tableRows[tableRows.length - 1]
      const totalRow = lastRow.replace('**Total**', directory)
      totalRows.push(totalRow)

      // Wrap each section in a details dropdown
      const sectionMarkdown = `<details>
<summary>${directory}</summary>
<br>

${tableRows.join('\n')}

</details>`
      detailsSections.push(sectionMarkdown)
    }

    // Generate summary table with totals
    const totalTable = generateTotalTable(totalRows)
    const fullSummary = `# 📋 File size Summary\n\n${totalTable}\n\n${detailsSections.join('\n\n')}`

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
      await commentOnPR(fullSummary)
    }

    // Save cache only on main branch (to create baseline for PR comparisons)
    await saveCache(cachePathBase, cacheKey)
  }
  catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
