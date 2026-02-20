#!/usr/bin/env node

/**
 * Node.js Entry Point (CLI)
 *
 * Usage:
 *   node src/node-cli.ts --start-date 2026-01-21T00:00:00Z [options]
 *
 * Options:
 *   --start-date    ISO 8601 date (required)
 *   --end-date      ISO 8601 end date, exclusive (optional)
 *   --max-records   Maximum records per page (default: 100)
 *   --max-total     Maximum total records to fetch (default: unlimited)
 *   --endpoint      CSW endpoint URL (default: GDI-DE)
 *   --outfile       Write results to file instead of stdout
 *   --verbose       Log raw CSW XML responses and curl-equivalent requests to stderr
 *
 * @module
 */

import { parseArgs } from "node:util"
import { writeFile } from "node:fs/promises"
import { fetchAllRecords } from "./csw-client.ts"

const DEFAULT_CSW_ENDPOINT = "https://gdk.gdi-de.org/geonetwork/srv/eng/csw"

const main = async () => {
  const { values } = parseArgs({
    options: {
      "start-date": { type: "string" },
      "end-date": { type: "string" },
      "max-records": { type: "string", default: "100" },
      "max-total": { type: "string" },
      endpoint: { type: "string" },
      outfile: { type: "string" },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  })

  if (values.help || !values["start-date"]) {
    printUsage()
    process.exit(values.help ? 0 : 1)
  }

  const options = {
    endpoint: values.endpoint || DEFAULT_CSW_ENDPOINT,
    startDate: values["start-date"],
    endDate: values["end-date"],
    maxRecordsPerPage: parseInt(values["max-records"], 10),
    maxTotalRecords: values["max-total"]
      ? parseInt(values["max-total"], 10)
      : Infinity,
  }

  console.error(`Fetching CSW records since ${options.startDate}...`)
  if (options.endDate) {
    console.error(`Until: ${options.endDate}`)
  }
  console.error(`Endpoint: ${options.endpoint}`)
  console.error(`Max records per page: ${options.maxRecordsPerPage}`)
  if (options.maxTotalRecords !== Infinity) {
    console.error(`Max total records: ${options.maxTotalRecords}`)
  }
  console.error("")

  const result = await fetchAllRecords({
    ...options,
    onPage: (pageResult, pageNumber) => {
      console.error(
        `Page ${pageNumber}: fetched ${pageResult.records.length} records ` +
          `(${pageResult.pagination.totalMatched} total matched)`,
      )
    },
    onRequest: values.verbose
      ? (endpoint, body) => {
          const singleLineBody = body.replace(/\s+/g, " ").trim()
          console.error(
            `curl -s -X POST '${endpoint}' -H 'Content-Type: application/xml' --data-raw '${singleLineBody}'`,
          )
        }
      : null,
    onResponse: values.verbose ? (xml) => console.error(xml) : null,
  })

  console.error("")
  console.error(
    `Done! Fetched ${result.summary.totalFetched} of ${result.summary.totalMatched} records.`,
  )
  console.error("")

  const output = JSON.stringify(result, null, 2)

  if (values.outfile) {
    await writeFile(values.outfile, output, "utf-8")
    console.error(`Results written to ${values.outfile}`)
  } else {
    console.log(output)
  }
}

const printUsage = () => {
  console.log(`
CSW Client - Fetch records from a CSW catalogue service

Usage:
  node src/node-cli.ts --start-date <date> [options]

Required:
  --start-date    ISO 8601 date (e.g., 2026-01-21T00:00:00Z)

Options:
  --end-date      ISO 8601 end date, exclusive (optional)
  --endpoint      CSW endpoint URL (default: ${DEFAULT_CSW_ENDPOINT})
  --max-records   Maximum records per page (default: 100)
  --max-total     Maximum total records to fetch (default: unlimited)
  --outfile       Write results to file instead of stdout
  --verbose       Log curl-equivalent requests and raw XML responses to stderr
  --help          Show this help message

Examples:
  # Fetch all records since a date
  node src/node-cli.ts --start-date 2026-01-21T00:00:00Z

  # Fetch with limit and save to file
  node src/node-cli.ts --start-date 2026-01-21T00:00:00Z --max-total 500 --outfile results.json
`)
}

main().catch((error: Error) => {
  console.error("Error:", error.message)
  process.exit(1)
})
