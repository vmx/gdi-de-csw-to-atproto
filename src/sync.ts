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
 * Environment variables:
 *   TIME_OFFSET_DAYS  Shift "now" back by this many days (default: 0)
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

import { parseArgs } from "node:util"
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

const readCursor = (): Cursor => {
  const raw = process.env.CSW_CURSOR
  if (!raw) return { lastRun: null, pending: null }
  return JSON.parse(raw) as Cursor
}

const writeCursor = (cursor: Cursor): void => {
  process.stdout.write(JSON.stringify(cursor) + "\n")
}

const main = async () => {
  const { values } = parseArgs({
    options: {
      "max-pages": { type: "string", default: "1" },
    },
  })
  const maxPages = parseInt(values["max-pages"], 10)

  const cursor = readCursor()
  const offsetMs =
    parseInt(process.env.TIME_OFFSET_DAYS ?? "0", 10) * 24 * 60 * 60 * 1000
  const now = new Date(Date.now() - offsetMs).toISOString()

  // First run ever: look back 15 minutes
  const startDate = cursor.pending?.startDate
    ?? cursor.lastRun
    ?? new Date(Date.now() - offsetMs - 15 * 60 * 1000).toISOString()
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
