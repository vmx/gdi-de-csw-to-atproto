#!/usr/bin/env node

/**
 * Node.js Entry Point (CLI)
 *
 * Usage:
 *   node node-cli.js --start-date 2026-01-21T00:00:00Z [options]
 *
 * Options:
 *   --start-date    ISO 8601 date (required)
 *   --max-records   Maximum records per page (default: 100)
 *   --max-total     Maximum total records to fetch (default: unlimited)
 *   --endpoint      CSW endpoint URL (default: GDI-DE)
 *   --output        Output format: json, summary, or ids (default: summary)
 *   --outfile       Write results to file instead of stdout
 */

import { fetchAllRecords, DEFAULT_CSW_ENDPOINT } from "./csw-client.js"
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
    maxRecordsPerPage: parseInt(args.maxRecords || "100", 10),
    maxTotalRecords: args.maxTotal ? parseInt(args.maxTotal, 10) : Infinity,
  }

  console.error(`Fetching CSW records since ${options.startDate}...`)
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
  })

  console.error("")
  console.error(
    `Done! Fetched ${result.summary.totalFetched} of ${result.summary.totalMatched} records.`,
  )
  console.error("")

  // Format output based on --output flag
  let output
  const outputFormat = args.output || "summary"

  switch (outputFormat) {
    case "json":
      // Full JSON output with all record details (excluding raw XML by default)
      output = JSON.stringify(
        {
          summary: result.summary,
          records: result.records.map((r) => ({
            source: r.source,
            dateStamp: r.dateStamp,
            // Include XML if --include-xml flag is set
            ...(args.includeXml ? { xml: r.xml } : {}),
          })),
        },
        null,
        2,
      )
      break

    case "ids":
      // Just the file identifiers, one per line
      output = result.records.map((r) => r.source).join("\n")
      break

    case "summary":
    default:
      // Summary with list of records
      output = JSON.stringify(
        {
          summary: result.summary,
          records: result.records.map((r) => ({
            source: r.source,
            dateStamp: r.dateStamp,
          })),
        },
        null,
        2,
      )
      break
  }

  if (args.outfile) {
    await writeFile(args.outfile, output, "utf-8")
    console.error(`Results written to ${args.outfile}`)
  } else {
    console.log(output)
  }
}

const parseArgs = (argv) => {
  const args = {}
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
        args[key] = true
      }
    }
  }
  return args
}

const printUsage = () => {
  console.log(`
CSW Client - Fetch records from a CSW catalogue service

Usage:
  node node-cli.js --start-date <date> [options]

Required:
  --start-date    ISO 8601 date (e.g., 2026-01-21T00:00:00Z)

Options:
  --endpoint      CSW endpoint URL (default: ${DEFAULT_CSW_ENDPOINT})
  --max-records   Maximum records per page (default: 100)
  --max-total     Maximum total records to fetch (default: unlimited)
  --output        Output format: json, summary, or ids (default: summary)
  --outfile       Write results to file instead of stdout
  --include-xml   Include raw XML in JSON output (use with --output json)
  --help          Show this help message

Examples:
  # Fetch all records since a date
  node node-cli.js --start-date 2026-01-21T00:00:00Z

  # Fetch with limit and save to file
  node node-cli.js --start-date 2026-01-21T00:00:00Z --max-total 500 --outfile results.json

  # Just get file identifiers
  node node-cli.js --start-date 2026-01-21T00:00:00Z --output ids
`)
}

main().catch((error) => {
  console.error("Error:", error.message)
  process.exit(1)
})
