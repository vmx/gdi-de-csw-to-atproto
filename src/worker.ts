/**
 * Cloudflare Worker Entry Point
 *
 * Deploy this as your Cloudflare Worker, ensuring csw-client.ts is bundled with it.
 *
 * Query parameters:
 *   - startDate: ISO 8601 date (required, e.g., 2026-01-21T00:00:00Z)
 *   - maxRecords: Maximum records per page (optional, default 100)
 *   - maxTotal: Maximum total records to fetch (optional, default unlimited)
 *   - endpoint: CSW endpoint URL (optional, defaults to GDI-DE)
 *   - page: If set to "single", only fetch one page (optional)
 *
 * @module
 */

import {
  fetchPage,
  fetchAllRecords,
  DEFAULT_CSW_ENDPOINT,
} from "./csw-client.ts"
import type { PageResult, AllRecordsResult } from "./csw-client.ts"

export default {
  async fetch(request: Request): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      })
    }

    try {
      const url = new URL(request.url)
      const params = url.searchParams

      // Parse query parameters
      const startDate = params.get("startDate")
      if (!startDate) {
        return jsonResponse(
          { error: "Missing required parameter: startDate" },
          400,
        )
      }

      const endpoint = params.get("endpoint") || DEFAULT_CSW_ENDPOINT
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
          maxRecords,
          startPosition,
        })
      } else {
        // Fetch all pages
        result = await fetchAllRecords({
          endpoint,
          startDate,
          maxRecordsPerPage: maxRecords,
          maxTotalRecords: maxTotal,
        })
      }

      // Return a summary without the full XML to keep response size manageable
      const response = singlePage
        ? {
            records: result.records.map((r) => ({
              source: r.source,
              dateStamp: r.dateStamp,
            })),
            pagination: (result as PageResult).pagination,
          }
        : {
            records: result.records.map((r) => ({
              source: r.source,
              dateStamp: r.dateStamp,
            })),
            summary: (result as AllRecordsResult).summary,
          }

      return jsonResponse(response)
    } catch (error) {
      console.error("CSW fetch error:", error)
      return jsonResponse(
        { error: error instanceof Error ? error.message : String(error) },
        500,
      )
    }
  },
}

/**
 * Create a JSON response with CORS headers
 *
 * @param data - Response body to serialize
 * @param status - HTTP status code
 * @returns Response with JSON content type and CORS headers
 */
const jsonResponse = (data: unknown, status = 200): Response => {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  })
}
