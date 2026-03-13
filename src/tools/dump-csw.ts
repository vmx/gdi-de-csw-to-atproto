/**
 * Dump CSW records to a file for deterministic replay.
 *
 * Fetches records from the CSW endpoint the same way sync.ts does,
 * but instead of posting to ATProto, writes each record as a JSON
 * line to an output file.
 *
 * Usage:
 *   node src/dump-csw.ts [options] <output-file>
 *
 * Options:
 *   --max-pages     Max pages to fetch (default: 1)
 *   --sleep-ms      Sleep between pages in ms (default: 60000)
 *
 * Environment variables:
 *   CSW_CURSOR  Cursor JSON (same as sync.ts)
 *
 * @module
 */

import { writeFileSync, appendFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { fetchPage } from "../csw-client.ts"

const DEFAULT_CSW_ENDPOINT = "https://gdk.gdi-de.org/geonetwork/srv/eng/csw"
const PAGE_SIZE = 100
const DEFAULT_SLEEP_MS = 60_000

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

const main = async () => {
  const { values, positionals } = parseArgs({
    options: {
      "max-pages": { type: "string", default: "1" },
      "sleep-ms": { type: "string", default: String(DEFAULT_SLEEP_MS) },
    },
    allowPositionals: true,
  })

  const outputFile = positionals[0]
  if (!outputFile) {
    console.error("Usage: node src/dump-csw.ts [options] <output-file>")
    process.exit(1)
  }

  const maxPages = parseInt(values["max-pages"], 10)
  const sleepMs = parseInt(values["sleep-ms"], 10)

  const cursor = readCursor()
  const now = new Date().toISOString()

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

  // Truncate the output file
  writeFileSync(outputFile, "")

  let position = startPosition
  let totalRecords = 0

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

    for (const record of result.records) {
      appendFileSync(outputFile, JSON.stringify(record) + "\n")
    }
    totalRecords += result.records.length

    if (!result.pagination.hasMore) {
      console.error(`Done. ${totalRecords} records written to ${outputFile}`)
      return
    }

    position = result.pagination.nextRecord

    if (page === maxPages) {
      console.error(
        `Page limit reached at position ${position}. ${totalRecords} records written to ${outputFile}`,
      )
      return
    }

    console.error(`Sleeping ${sleepMs / 1000}s before next page...`)
    await sleep(sleepMs)
  }
}

main().catch((error: Error) => {
  console.error("Error:", error.message)
  process.exit(1)
})
