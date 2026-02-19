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
 *   - GET /query?startDate=...&endDate=...&maxRecords=...&startPosition=...&endpoint=... — debug query
 *
 * Query parameters (for /query):
 *   - startDate: ISO 8601 date (required, e.g., 2026-01-21T00:00:00Z)
 *   - endDate: ISO 8601 end date, exclusive (optional)
 *   - maxRecords: Maximum records per page (optional, default 100)
 *   - startPosition: Starting position for pagination (optional, 1-based; returns a single page)
 *   - endpoint: CSW endpoint URL (optional, defaults to GDI-DE)
 *
 * @module
 */

import {
  type AllRecordsResult,
  type PageResult,
  fetchAllRecords,
  fetchPage,
} from "./csw-client.ts"

const DEFAULT_CSW_ENDPOINT = "https://gdk.gdi-de.org/geonetwork/srv/eng/csw"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/") {
      return new Response(
        "gdi-de-csw-to-atproto is running. Use /query to query CSW.",
      )
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

        const endpoint = params.get("endpoint") || DEFAULT_CSW_ENDPOINT
        const endDate = params.get("endDate") || undefined
        const maxRecords = params.has("maxRecords")
          ? parseInt(params.get("maxRecords") as string, 10)
          : 100

        let result: PageResult | AllRecordsResult
        if (params.has("startPosition")) {
          const startPosition = parseInt(
            params.get("startPosition") as string,
            10,
          )
          result = await fetchPage({
            endpoint,
            startDate,
            endDate,
            maxRecords,
            startPosition,
          })
        } else {
          result = await fetchAllRecords({
            endpoint,
            startDate,
            endDate,
            maxRecordsPerPage: maxRecords,
          })
        }

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

    const result = await fetchAllRecords({
      endpoint: DEFAULT_CSW_ENDPOINT,
      startDate,
      endDate,
    })

    console.log(
      `Scheduled run: fetched ${result.summary.totalFetched} of ${result.summary.totalMatched} records (${result.summary.pagesRequested} pages) from ${startDate} to ${endDate}\n${JSON.stringify(result)}`,
    )
  },
}
