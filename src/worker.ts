/**
 * Cloudflare Worker Entry Point
 *
 * Deploy this as your Cloudflare Worker, ensuring csw-client.ts is bundled with it.
 *
 * Query parameters:
 *   - startDate: ISO 8601 date (required, e.g., 2026-01-21T00:00:00Z)
 *   - endDate: ISO 8601 end date, exclusive (optional)
 *   - maxRecords: Maximum records per page (optional, default 100)
 *   - maxTotal: Maximum total records to fetch (optional, default unlimited)
 *   - endpoint: CSW endpoint URL (optional, defaults to GDI-DE)
 *   - page: If set to "single", only fetch one page (optional)
 *
 * @module
 */

import { fetchPage, fetchAllRecords } from "./csw-client.ts"
import type { PageResult, AllRecordsResult } from "./csw-client.ts"

const DEFAULT_CSW_ENDPOINT = "https://gdk.gdi-de.org/geonetwork/srv/eng/csw"

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      const params = url.searchParams

      // Parse query parameters
      const startDate = params.get("startDate")
      if (!startDate) {
        return Response.json(
          { error: "Missing required parameter: startDate" },
          { status: 400 },
        )
      }

      const endpoint = params.get("endpoint") || DEFAULT_CSW_ENDPOINT
      const endDate = params.get("endDate") || undefined
      const maxRecords = parseInt(params.get("maxRecords") || "100", 10)
      const maxTotal = params.get("maxTotal")
        ? parseInt(params.get("maxTotal") as string, 10)
        : Infinity
      const singlePage = params.get("page") === "single"
      const startPosition = parseInt(params.get("startPosition") || "1", 10)

      let result: PageResult | AllRecordsResult

      if (singlePage) {
        // Fetch only a single page
        result = await fetchPage({
          endpoint,
          startDate,
          endDate,
          maxRecords,
          startPosition,
        })
      } else {
        // Fetch all pages
        result = await fetchAllRecords({
          endpoint,
          startDate,
          endDate,
          maxRecordsPerPage: maxRecords,
          maxTotalRecords: maxTotal,
        })
      }

      // Return a summary without the full XML to keep response size manageable
      const response = singlePage
        ? {
            records: result.records.map((r) => ({
              identifier: r.identifier,
              source: r.source,
              dateStamp: r.dateStamp,
            })),
            pagination: (result as PageResult).pagination,
          }
        : {
            records: result.records.map((r) => ({
              identifier: r.identifier,
              source: r.source,
              dateStamp: r.dateStamp,
            })),
            summary: (result as AllRecordsResult).summary,
          }

      return Response.json(response)
    } catch (error) {
      console.error("CSW fetch error:", error)
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      )
    }
  },
}
