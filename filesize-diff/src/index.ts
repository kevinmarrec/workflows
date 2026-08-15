import * as fs from 'node:fs'

import * as core from '@actions/core'
import * as github from '@actions/github'
import { filesize } from 'filesize'
import { join } from 'pathe'
import { glob } from 'tinyglobby'

import { type Baseline, loadCachedStats, restoreCache, saveCache, saveStats } from './cache'
import { commentOnPR } from './comment'

// Bundlers separate the hash with either a dash (`app-Ckdnwnhq.js`) or a dot
// (`entry-client-routing.CHIDzETC.js`, which Vike emits).
// ponytail: a real name whose last-but-one dotted segment is 8-10 chars (`foo.settings.js`) is
// mistaken for a hash and merged with its siblings. Match the hash alphabet if that ever bites.
const VITE_HASH_REGEX = /[.-][\w-]{8,10}(\.[a-z]+)$/i
const PATH_SEPARATORS_REGEX = /[\\/]/g

export interface FileStat {
  file: string
  size: number
  /**
   * How many files this entry merges, when normalization mapped several hashed names onto one.
   * Absent in baselines published before this field existed.
   */
  count?: number
}

interface Row {
  label: string
  base: number
  head: number
}

export const ASSET_FOLDERS = ['assets'] as const

const COLUMN_HEADERS = {
  BASE: 'Base (Before Merge)',
  HEAD: 'Head (After Merge)',
  DELTA: 'Delta',
} as const

export function normalizeAssetFilename(file: string): string {
  // Only normalize Vite build hashed asset filenames for files in asset folders
  if (!ASSET_FOLDERS.some(folder => file.startsWith(`${folder}/`) || file.includes(`/${folder}/`))) {
    return file
  }

  return file.replace(VITE_HASH_REGEX, '$1')
}

/**
 * The row a file is grouped under. Extension-less files group under their own name rather than a
 * shared bucket: a compiled binary has no type in common with anything else in the directory.
 */
export function fileGroup(file: string): string {
  const base = file.split('/').pop()!
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : base
}

export async function getFileStats(directory: string, ignore: string[] = []): Promise<FileStat[]> {
  const files = await glob(['**/*'], { cwd: directory, ignore })

  const sized = await Promise.all(
    files.map(async file => ({
      file: normalizeAssetFilename(file),
      size: (await fs.promises.stat(join(directory, file))).size,
    })),
  )

  // Normalization maps every `chunk-<hash>.js` onto one name, so entries must be summed rather
  // than keyed: keeping the last would drop the others from the table *and* from the total.
  const merged = new Map<string, FileStat>()

  for (const { file, size } of sized) {
    const previous = merged.get(file)
    merged.set(file, { file, size: (previous?.size ?? 0) + size, count: (previous?.count ?? 0) + 1 })
  }

  return [...merged.values()]
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

/**
 * States the baseline situation above the table, because a run with nothing to compare against
 * produces a sizes-only table that otherwise looks exactly like a diff showing no change.
 */
export function baselineNote(baseline: Baseline): string {
  if (baseline.status === 'restored') return ''

  if (baseline.status === 'publishing') {
    return `> Publishing the baseline for \`${baseline.branch}\`, so there is nothing to compare against.\n\n`
  }

  if (!baseline.branch) {
    return '> **No baseline**: the branch to compare against could not be determined from the event. Sizes are listed without a comparison.\n\n'
  }

  return `> **No baseline for \`${baseline.branch}\`**: sizes are listed without a comparison. A baseline is published by every run on \`${baseline.branch}\`, and GitHub evicts caches left unused for 7 days.\n\n`
}

function generateTable(label: string, rows: Row[], hasCache: boolean, total?: Row): string {
  const header = hasCache
    ? `| ${label} | ${COLUMN_HEADERS.BASE} | ${COLUMN_HEADERS.HEAD} | ${COLUMN_HEADERS.DELTA} |\n| :--- | ---: | ---: | ---: |`
    : `| ${label} | Size |\n| :--- | ---: |`

  const body = rows.map(row => hasCache
    ? `| ${row.label} | ${filesize(row.base)} | ${filesize(row.head)} | ${formatDiff(row.head, row.base)} |`
    : `| ${row.label} | ${filesize(row.head)} |`)

  if (total) {
    body.push(formatTotalRow(total.label, total.head, total.base, hasCache))
  }

  return [header, ...body].join('\n')
}

/**
 * One row per extension, largest first — the shape of a build is easier to read than its file list,
 * and the file list is one click away.
 */
export function groupRows(rows: (Row & { group: string })[]): (Row & { group: string })[] {
  const groups = new Map<string, Row & { group: string }>()

  for (const { group, base, head } of rows) {
    const previous = groups.get(group) ?? { group, label: `\`${group}\``, base: 0, head: 0 }
    groups.set(group, { ...previous, base: previous.base + base, head: previous.head + head })
  }

  return [...groups.values()].sort((a, b) => b.head - a.head || a.group.localeCompare(b.group))
}

export function buildRows(current: FileStat[], cached: FileStat[] | null): (Row & { group: string })[] {
  const currentMap = new Map(current.map(s => [s.file, s]))
  const cachedMap = new Map((cached ?? []).map(s => [s.file, s]))

  return [...new Set([...currentMap.keys(), ...cachedMap.keys()])].map((file) => {
    const count = (currentMap.get(file) ?? cachedMap.get(file))?.count ?? 1

    return {
      label: count > 1 ? `${file} (×${count})` : file,
      group: fileGroup(file),
      base: cachedMap.get(file)?.size ?? 0,
      head: currentMap.get(file)?.size ?? 0,
    }
  })
}

export interface DirectoryReport {
  hasChanges: boolean
  section: string
  totalRow: string
}

export function generateSection(directory: string, current: FileStat[], cached: FileStat[] | null): DirectoryReport {
  const hasCache = cached !== null
  const rows = buildRows(current, cached)
  const groups = groupRows(rows)

  const order = new Map(groups.map((group, index) => [group.group, index]))
  const files = rows.toSorted((a, b) =>
    order.get(a.group)! - order.get(b.group)! || a.label.localeCompare(b.label))

  const total = {
    label: 'Total',
    base: rows.reduce((sum, row) => sum + row.base, 0),
    head: rows.reduce((sum, row) => sum + row.head, 0),
  }

  const entries = files.length
  const parts = [`### ${directory}`, '']

  // A single group restates the directory total three times over — the summary table already
  // carries it, so the type table is dropped and the file list stands alone.
  if (groups.length > 1) {
    parts.push(generateTable('Type', groups, hasCache, total), '')
  }

  parts.push(
    '<details>',
    `<summary>${entries} ${entries === 1 ? 'entry' : 'entries'}</summary>`,
    '',
    generateTable('File', files, hasCache),
    '',
    '</details>',
  )

  return {
    hasChanges: !hasCache || rows.some(row => row.base !== row.head),
    section: parts.join('\n'),
    totalRow: formatTotalRow(directory, total.head, total.base, hasCache),
  }
}

export async function analyzeDirectory(
  directory: string,
  cachePath: string,
  ignore: string[] = [],
): Promise<DirectoryReport> {
  // Check if directory exists
  if (!fs.existsSync(directory)) {
    core.setFailed(`Directory not found at ${directory}. Please ensure the directory exists before running this action.`)
    throw new Error(`Directory not found at ${directory}`)
  }

  const currentStats = await getFileStats(directory, ignore)

  // Load cached stats
  const cachedStats = fs.existsSync(cachePath) ? loadCachedStats(cachePath) : null

  // Save current stats
  saveStats(currentStats, cachePath)

  return generateSection(directory, currentStats, cachedStats)
}

export async function run(): Promise<void> {
  try {
    const directoriesInput = core.getInput('directories', { required: true })
    const cachePathBase = core.getInput('cache-path') || '.github/cache/build-stats'
    // The baseline branch is appended to this, so the key must not name a branch itself.
    const cacheKey = core.getInput('cache-key') || 'build-stats'
    const prComment = core.getBooleanInput('comment-on-pr', { required: false }) ?? true

    const directories = directoriesInput.split(',').map(d => d.trim()).filter(Boolean)
    const ignore = (core.getInput('ignore') || '').split(',').map(p => p.trim()).filter(Boolean)

    if (directories.length === 0) {
      return core.setFailed('At least one directory must be provided')
    }

    const baseline = await restoreCache(cachePathBase, cacheKey)

    const results = await Promise.all(
      directories.map(async (directory) => {
        // Use normalized directory path for cache filename to avoid collisions
        const cacheFileName = directory.replace(PATH_SEPARATORS_REGEX, '-')
        const cachePath = join(cachePathBase, `${cacheFileName}.json`)

        core.info(`Analyzing ${directory}...`)

        return analyzeDirectory(directory, cachePath, ignore)
      }),
    )

    const overallHasChanges = results.some(result => result.hasChanges)
    const totalTable = generateTotalTable(results.map(result => result.totalRow))
    const sections = results.map(result => result.section)
    const fullSummary = `# 📋 File size Summary\n\n${baselineNote(baseline)}${totalTable}\n\n${sections.join('\n\n')}`

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
