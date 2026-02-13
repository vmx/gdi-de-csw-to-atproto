/**
 * CSW (Catalogue Service for the Web) Client
 * Works in both Cloudflare Workers and Node.js environments
 * Uses SAX streaming parser for memory efficiency
 *
 * @module
 */

import sax from "sax"

const DEFAULT_CSW_ENDPOINT = "https://gdk.gdi-de.org/geonetwork/srv/eng/csw"
const DEFAULT_MAX_RECORDS = 100

/** A single metadata record from a CSW response */
interface CswRecord {
  /** Source URL extracted from the INSPIRE citation identifier */
  source: string | null
  /** Date the record was last modified */
  dateStamp: string | null
  /** Title from the citation */
  title: string | null
}

/** Pagination info from the CSW SearchResults element */
interface Pagination {
  numberOfRecordsMatched: number
  numberOfRecordsReturned: number
  nextRecord: number
  hasMore: boolean
}

/** Result from fetching a single page of CSW records */
interface PageResult {
  records: CswRecord[]
  pagination: {
    totalMatched: number
    returned: number
    nextRecord: number
    hasMore: boolean
  }
}

/** Result from fetching all records with pagination */
interface AllRecordsResult {
  records: CswRecord[]
  summary: {
    totalMatched: number
    totalFetched: number
    pagesRequested: number
  }
}

/**
 * Build the XML request body for CSW GetRecords
 *
 * @param options.startDate - ISO 8601 date string (e.g., '2026-01-21T00:00:00Z')
 * @param options.endDate - Optional ISO 8601 end date (exclusive upper bound)
 * @param options.maxRecords - Maximum records per request
 * @param options.startPosition - Starting position for pagination (1-based)
 * @returns XML request body
 */
const buildGetRecordsXml = ({
  startDate,
  endDate,
  maxRecords,
  startPosition,
}: {
  startDate: string
  endDate?: string
  maxRecords: number
  startPosition: number
}): string => {
  const startFilter = `<ogc:PropertyIsGreaterThanOrEqualTo>
          <ogc:PropertyName>apiso:Modified</ogc:PropertyName>
          <ogc:Literal>${startDate}</ogc:Literal>
        </ogc:PropertyIsGreaterThanOrEqualTo>`

  let filter: string
  if (endDate) {
    filter = `<ogc:And>
        ${startFilter}
        <ogc:PropertyIsLessThan>
          <ogc:PropertyName>apiso:Modified</ogc:PropertyName>
          <ogc:Literal>${endDate}</ogc:Literal>
        </ogc:PropertyIsLessThan>
        </ogc:And>`
  } else {
    filter = startFilter
  }

  return `<?xml version="1.0"?>
<csw:GetRecords xmlns:csw="http://www.opengis.net/cat/csw/2.0.2" xmlns:ogc="http://www.opengis.net/ogc" service="CSW" version="2.0.2" resultType="results" outputSchema="http://www.isotc211.org/2005/gmd" maxRecords="${maxRecords}" startPosition="${startPosition}">
  <csw:Query typeNames="csw:Record">
    <csw:ElementSetName>full</csw:ElementSetName>
    <csw:Constraint version="1.1.0">
      <ogc:Filter>
        ${filter}
      </ogc:Filter>
    </csw:Constraint>
    <ogc:SortBy>
      <ogc:SortProperty>
        <ogc:PropertyName>apiso:Modified</ogc:PropertyName>
        <ogc:SortOrder>ASC</ogc:SortOrder>
      </ogc:SortProperty>
    </ogc:SortBy>
  </csw:Query>
</csw:GetRecords>`
}

/**
 * Parse CSW GetRecords response using streaming SAX parser
 *
 * @param xmlText - Raw XML response
 * @returns Parsed result with pagination info and records
 */
const parseGetRecordsResponse = (
  xmlText: string,
): { pagination: Pagination; records: CswRecord[] } => {
  const parser = sax.parser(true, { trim: true, normalize: true })

  const result: { pagination: Pagination; records: CswRecord[] } = {
    pagination: {
      numberOfRecordsMatched: 0,
      numberOfRecordsReturned: 0,
      nextRecord: 0,
      hasMore: false,
    },
    records: [],
  }

  // State tracking
  let currentRecord: CswRecord | null = null
  let currentPath: string[] = []
  let textBuffer = ""

  parser.onerror = (err) => {
    throw new Error(`XML parsing error: ${err.message}`)
  }

  parser.onopentag = (node) => {
    currentPath.push(node.name)
    textBuffer = ""

    if (node.name === "csw:SearchResults") {
      const attrs = node.attributes as Record<string, string>
      result.pagination.numberOfRecordsMatched = parseInt(
        attrs.numberOfRecordsMatched || "0",
        10,
      )
      result.pagination.numberOfRecordsReturned = parseInt(
        attrs.numberOfRecordsReturned || "0",
        10,
      )
      result.pagination.nextRecord = parseInt(attrs.nextRecord || "0", 10)
      result.pagination.hasMore =
        result.pagination.nextRecord > 0 &&
        result.pagination.nextRecord <= result.pagination.numberOfRecordsMatched
    } else if (node.name === "gmd:MD_Metadata") {
      currentRecord = {
        source: null,
        dateStamp: null,
        title: null,
      }
    }
  }

  parser.ontext = (text) => {
    textBuffer += text
  }

  parser.onclosetag = (name) => {
    const pathStr = currentPath.join("/")

    if (currentRecord) {
      // Extract source URL from gmd:identificationInfo/*/gmd:citation/gmd:CI_Citation/gmd:identifier/gmd:MD_Identifier/gmd:code/gco:CharacterString
      if (
        pathStr.endsWith(
          "gmd:citation/gmd:CI_Citation/gmd:identifier/gmd:MD_Identifier/gmd:code/gco:CharacterString",
        )
      ) {
        currentRecord.source = textBuffer.trim()
      }
      // Extract dateStamp
      else if (
        pathStr.endsWith("gmd:dateStamp/gco:DateTime") ||
        pathStr.endsWith("gmd:dateStamp/gco:Date")
      ) {
        currentRecord.dateStamp = textBuffer.trim()
      }
      // Extract title from identification info
      else if (
        pathStr.endsWith(
          "gmd:citation/gmd:CI_Citation/gmd:title/gco:CharacterString",
        )
      ) {
        currentRecord.title = textBuffer.trim()
      }
    }

    if (name === "gmd:MD_Metadata" && currentRecord) {
      result.records.push(currentRecord)
      currentRecord = null
    }

    currentPath.pop()
  }

  parser.write(xmlText).close()
  return result
}

/**
 * Fetch a single page of CSW records
 *
 * @param options.endpoint - CSW endpoint URL
 * @param options.startDate - ISO 8601 date string
 * @param options.endDate - Optional ISO 8601 end date (exclusive upper bound)
 * @param options.maxRecords - Maximum records per request
 * @param options.startPosition - Starting position (1-based)
 * @returns Result with records array and pagination info
 */
const fetchPage = async ({
  endpoint = DEFAULT_CSW_ENDPOINT,
  startDate,
  endDate,
  maxRecords = DEFAULT_MAX_RECORDS,
  startPosition = 1,
}: {
  endpoint?: string
  startDate: string
  endDate?: string
  maxRecords?: number
  startPosition?: number
}): Promise<PageResult> => {
  const xmlBody = buildGetRecordsXml({
    startDate,
    endDate,
    maxRecords,
    startPosition,
  })

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/xml",
    },
    body: xmlBody,
  })

  if (!response.ok) {
    throw new Error(
      `CSW request failed: ${response.status} ${response.statusText}`,
    )
  }

  const xmlText = await response.text()
  const { pagination, records } = parseGetRecordsResponse(xmlText)

  return {
    records,
    pagination: {
      totalMatched: pagination.numberOfRecordsMatched,
      returned: pagination.numberOfRecordsReturned,
      nextRecord: pagination.nextRecord,
      hasMore: pagination.hasMore,
    },
  }
}

/**
 * Fetch all records since a given date, handling pagination automatically
 *
 * @param options.endpoint - CSW endpoint URL
 * @param options.startDate - ISO 8601 date string
 * @param options.endDate - Optional ISO 8601 end date (exclusive upper bound)
 * @param options.maxRecordsPerPage - Maximum records per request
 * @param options.maxTotalRecords - Maximum total records to fetch (for safety)
 * @param options.onPage - Optional callback called after each page
 * @returns Result with all records and summary
 */
const fetchAllRecords = async ({
  endpoint = DEFAULT_CSW_ENDPOINT,
  startDate,
  endDate,
  maxRecordsPerPage = DEFAULT_MAX_RECORDS,
  maxTotalRecords = Infinity,
  onPage = null,
}: {
  endpoint?: string
  startDate: string
  endDate?: string
  maxRecordsPerPage?: number
  maxTotalRecords?: number
  onPage?: ((pageResult: PageResult, pageNumber: number) => void) | null
}): Promise<AllRecordsResult> => {
  const allRecords: CswRecord[] = []
  let startPosition = 1
  let pageNumber = 0
  let totalMatched = 0

  while (allRecords.length < maxTotalRecords) {
    pageNumber++

    const pageResult = await fetchPage({
      endpoint,
      startDate,
      endDate,
      maxRecords: Math.min(
        maxRecordsPerPage,
        maxTotalRecords - allRecords.length,
      ),
      startPosition,
    })

    totalMatched = pageResult.pagination.totalMatched
    allRecords.push(...pageResult.records)

    if (onPage) {
      onPage(pageResult, pageNumber)
    }

    if (!pageResult.pagination.hasMore) {
      break
    }

    startPosition = pageResult.pagination.nextRecord
  }

  return {
    records: allRecords,
    summary: {
      totalMatched,
      totalFetched: allRecords.length,
      pagesRequested: pageNumber,
    },
  }
}

export type { CswRecord, PageResult, AllRecordsResult }
export { DEFAULT_CSW_ENDPOINT, fetchPage, fetchAllRecords }
