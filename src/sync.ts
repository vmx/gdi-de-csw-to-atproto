/**
 * GitHub Actions Sync Script
 *
 * Reads the cursor from the CSW_CURSOR environment variable (a JSON string
 * set as a GitHub repository variable), fetches CSW records, logs them,
 * then prints the updated cursor as JSON to stdout for the workflow to
 * store back as a repository variable.
 *
 * Usage:
 *   node src/sync.ts [options]
 *
 * Options:
 *   --max-pages     Max pages per run (default: 1)
 *
 * On each run:
 *   - If cursor.pending exists, resumes the in-progress window
 *   - Otherwise starts a new window from cursor.lastRun to now
 *   - Fetches up to --max-pages pages, sleeping 1 minute between each
 *   - If more pages remain after the limit, saves the cursor and exits
 *   - If the window is fully processed, updates lastRun and clears pending
 *
 * @module
 */

import { fetchPage } from "./csw-client.ts"

const DEFAULT_CSW_ENDPOINT = "https://gdk.gdi-de.org/geonetwork/srv/eng/csw"
const PAGE_SIZE = 200
const SLEEP_MS = 60_000 // 1 minute between pages

interface Cursor {
  lastRun: string | null
  pending: {
    startDate: string
    endDate: string
    startPosition: number
  } | null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const parseArgs = (argv: string[]): Record<string, string> => {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args[key] = argv[i + 1]
        i++
      } else {
        args[key] = "true"
      }
    }
  }
  return args
}

const readCursor = (): Cursor => {
  const raw = process.env.CSW_CURSOR
  if (!raw) return { lastRun: null, pending: null }
  return JSON.parse(raw) as Cursor
}

const writeCursor = (cursor: Cursor): void => {
  process.stdout.write(JSON.stringify(cursor) + "\n")
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const maxPages = parseInt(args.maxPages ?? "1", 10)

  const cursor = readCursor()
  const now = new Date().toISOString()

  // First run ever: look back 15 minutes
  const startDate = cursor.pending?.startDate
    ?? cursor.lastRun
    ?? new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const endDate = cursor.pending?.endDate ?? now
  const startPosition = cursor.pending?.startPosition ?? 1

  if (cursor.pending) {
    console.error(
      `Resuming: ${startDate} → ${endDate}, startPosition=${startPosition}`,
    )
  } else {
    console.error(`New window: ${startDate} → ${endDate}`)
  }

  let position = startPosition

  for (let page = 1; page <= maxPages; page++) {
    console.error(`Page ${page}/${maxPages} (startPosition=${position})`)

    const result = await fetchPage({
      endpoint: DEFAULT_CSW_ENDPOINT,
      startDate,
      endDate,
      maxRecords: PAGE_SIZE,
      startPosition: position,
    })

    console.error(
      `Fetched ${result.records.length} records (${result.pagination.totalMatched} total matched)`,
    )
    console.error(JSON.stringify(result.records))

    if (!result.pagination.hasMore) {
      writeCursor({ lastRun: endDate, pending: null })
      console.error(`Window complete. lastRun updated to ${endDate}`)
      return
    }

    position = result.pagination.nextRecord

    if (page === maxPages) {
      writeCursor({
        lastRun: cursor.lastRun,
        pending: { startDate, endDate, startPosition: position },
      })
      console.error(`Page limit reached. Cursor saved at position ${position}`)
      return
    }

    console.error("Sleeping 1 minute before next page...")
    await sleep(SLEEP_MS)
  }
}

main().catch((error: Error) => {
  console.error("Error:", error.message)
  process.exit(1)
})
