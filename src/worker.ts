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
 *
 * @module
 */

import { fetchAllRecords } from "./csw-client.ts"

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

      const result = await fetchAllRecords({
        endpoint,
        startDate,
        endDate,
        maxRecordsPerPage: maxRecords,
        maxTotalRecords: maxTotal,
      })

      return Response.json({
        records: result.records.map((r) => ({
          identifier: r.identifier,
          source: r.source,
          dateStamp: r.dateStamp,
        })),
        summary: result.summary,
      })
    } catch (error) {
      console.error("CSW fetch error:", error)
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      )
    }
  },
}
