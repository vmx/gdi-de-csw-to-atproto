/**
 * Replay dumped CSW records to a PDS.
 *
 * Reads a JSONL file (one record per line, as produced by dump-csw.ts)
 * and posts the records to ATProto in batches, like sync.ts does.
 *
 * Usage:
 *   ATP_PDS_URL=... BLUESKY_IDENTIFIER=... BLUESKY_PASSWORD=... node src/tools/replay.ts [options] <input-file>
 *
 * Options:
 *   --batch-size    Records per batch (default: 100)
 *   --sleep-ms      Sleep between batches in ms (default: 60000)
 *
 * @module
 */

import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { createSessionFromEnv, putRecords } from "../atproto.ts"
import type { CswRecord } from "../csw-client.ts"

const DEFAULT_CSW_ENDPOINT = "https://gdk.gdi-de.org/geonetwork/srv/eng/csw"
const DEFAULT_BATCH_SIZE = 100
const DEFAULT_SLEEP_MS = 60_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const main = async () => {
  const { values, positionals } = parseArgs({
    options: {
      "batch-size": { type: "string", default: String(DEFAULT_BATCH_SIZE) },
      "sleep-ms": { type: "string", default: String(DEFAULT_SLEEP_MS) },
    },
    allowPositionals: true,
  })

  const inputFile = positionals[0]
  if (!inputFile) {
    console.error("Usage: node src/tools/replay.ts [options] <input-file>")
    process.exit(1)
  }

  const batchSize = parseInt(values["batch-size"], 10)
  const sleepMs = parseInt(values["sleep-ms"], 10)

  const lines = readFileSync(inputFile, "utf-8").split("\n").filter((l) => l.length > 0)
  const records: CswRecord[] = lines.map((line) => JSON.parse(line) as CswRecord)
  console.error(`Loaded ${records.length} records from ${inputFile}`)

  const session = await createSessionFromEnv()
  console.error(`Authenticated as ${session.handle}`)

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1
    const totalBatches = Math.ceil(records.length / batchSize)

    console.error(`Batch ${batchNum}/${totalBatches} (${batch.length} records)`)
    await putRecords(session, DEFAULT_CSW_ENDPOINT, batch)
    console.error(`Posted ${batch.length} records to ATProto`)

    if (i + batchSize < records.length) {
      console.error(`Sleeping ${sleepMs / 1000}s before next batch...`)
      await sleep(sleepMs)
    }
  }

  console.error(`Done. Posted ${records.length} records total.`)
}

main().catch((error: Error) => {
  console.error("Error:", error.message)
  process.exit(1)
})
