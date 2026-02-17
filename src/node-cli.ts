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

import { fetchAllRecords } from "./csw-client.ts"

const DEFAULT_CSW_ENDPOINT = "https://gdk.gdi-de.org/geonetwork/srv/eng/csw"
import { writeFile } from "fs/promises"

const main = async () => {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || !args.startDate) {
    printUsage()
    process.exit(args.help ? 0 : 1)
  }

  const options = {
    endpoint: args.endpoint || DEFAULT_CSW_ENDPOINT,
    startDate: args.startDate,
    endDate: args.endDate,
    maxRecordsPerPage: parseInt(args.maxRecords || "100", 10),
    maxTotalRecords: args.maxTotal ? parseInt(args.maxTotal, 10) : Infinity,
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
    onRequest: args.verbose
      ? (endpoint, body) => {
          const singleLineBody = body.replace(/\s+/g, " ").trim()
          console.error(
            `curl -s -X POST '${endpoint}' -H 'Content-Type: application/xml' --data-raw '${singleLineBody}'`,
          )
        }
      : null,
    onResponse: args.verbose ? (xml) => console.error(xml) : null,
  })

  console.error("")
  console.error(
    `Done! Fetched ${result.summary.totalFetched} of ${result.summary.totalMatched} records.`,
  )
  console.error("")

  const output = JSON.stringify(result, null, 2)

  if (args.outfile) {
    await writeFile(args.outfile, output, "utf-8")
    console.error(`Results written to ${args.outfile}`)
  } else {
    console.log(output)
  }
}

/**
 * Parse CLI arguments into a key-value map.
 * Converts kebab-case flags to camelCase.
 *
 * @param argv - Command line arguments (without node and script path)
 * @returns Parsed arguments as key-value pairs
 */
const parseArgs = (argv: string[]): Record<string, string> => {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith("--")) {
      // Convert kebab-case to camelCase for internal use
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      // Check if next arg is a value or another flag
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
