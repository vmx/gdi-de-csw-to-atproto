/**
 * Cloudflare Worker Entry Point
 *
 * Supports both scheduled execution (via Cron Triggers) and HTTP requests
 * (for debugging). Uses KV to persist the last run timestamp.
 *
 * KV binding: CSW_KV
 *
 * HTTP routes:
 *   - GET / — alive check
 *   - GET /query?startDate=...&endDate=...&maxRecords=...&maxTotal=...&endpoint=... — debug query
 *
 * Query parameters (for /query):
 *   - startDate: ISO 8601 date (required, e.g., 2026-01-21T00:00:00Z)
 *   - endDate: ISO 8601 end date, exclusive (optional)
 *   - maxRecords: Maximum records per page (optional, default 100)
 *   - maxTotal: Maximum total records to fetch (optional, default unlimited)
 *   - endpoint: CSW endpoint URL (optional, defaults to GDI-DE)
 *
 * @module
 */

import { type AllRecordsResult, fetchAllRecords } from "./csw-client.ts"

const DEFAULT_CSW_ENDPOINT = "https://gdk.gdi-de.org/geonetwork/srv/eng/csw"

const queryCsw = async ({
  startDate,
  endDate,
  endpoint = DEFAULT_CSW_ENDPOINT,
  maxRecordsPerPage = 100,
  maxTotalRecords = Infinity,
}: {
  startDate: string
  endDate?: string
  endpoint?: string
  maxRecordsPerPage?: number
  maxTotalRecords?: number
}): Promise<AllRecordsResult> => {
  return fetchAllRecords({
    endpoint,
    startDate,
    endDate,
    maxRecordsPerPage,
    maxTotalRecords,
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/") {
      return new Response("csw-scraper is running. Use /query to query CSW.")
    }

    if (url.pathname === "/query") {
      try {
        const params = url.searchParams
        const startDate = params.get("startDate")
        if (!startDate) {
          return Response.json(
            { error: "Missing required parameter: startDate" },
            { status: 400 },
          )
        }

        const endpoint = params.get("endpoint") || undefined
        const endDate = params.get("endDate") || undefined
        const maxRecordsPerPage = params.has("maxRecords")
          ? parseInt(params.get("maxRecords") as string, 10)
          : undefined
        const maxTotalRecords = params.has("maxTotal")
          ? parseInt(params.get("maxTotal") as string, 10)
          : undefined

        const result = await queryCsw({
          startDate,
          endDate,
          endpoint,
          maxRecordsPerPage,
          maxTotalRecords,
        })

        return Response.json(result)
      } catch (error) {
        console.error("CSW fetch error:", error)
        return Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        )
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 })
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const endDate = new Date().toISOString()

    let startDate = await env.CSW_KV.get("lastRun")
    if (!startDate) {
      // First run ever: look back 24 hours
      startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    }

    await env.CSW_KV.put("lastRun", endDate)

    const result = await queryCsw({ startDate, endDate })

    console.log(
      `Scheduled run: fetched ${result.summary.totalFetched} of ${result.summary.totalMatched} records (${result.summary.pagesRequested} pages) from ${startDate} to ${endDate}\n${JSON.stringify(result)}`,
    )
  },
}
