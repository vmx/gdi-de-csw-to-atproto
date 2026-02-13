/**
 * CSW (Catalogue Service for the Web) Client
 * Works in both Cloudflare Workers and Node.js environments
 * Uses SAX streaming parser for memory efficiency
 */

import sax from 'sax'

const DEFAULT_CSW_ENDPOINT = 'https://gdk.gdi-de.org/geonetwork/srv/eng/csw'
const DEFAULT_MAX_RECORDS = 100

/**
 * Build the XML request body for CSW GetRecords
 * @param {Object} options
 * @param {string} options.startDate - ISO 8601 date string (e.g., '2026-01-21T00:00:00Z')
 * @param {number} options.maxRecords - Maximum records per request
 * @param {number} options.startPosition - Starting position for pagination (1-based)
 * @returns {string} XML request body
 */
const buildGetRecordsXml = ({ startDate, maxRecords, startPosition }) => {
  return `<?xml version="1.0"?>
<csw:GetRecords xmlns:csw="http://www.opengis.net/cat/csw/2.0.2" xmlns:ogc="http://www.opengis.net/ogc" service="CSW" version="2.0.2" resultType="results" outputSchema="http://www.isotc211.org/2005/gmd" maxRecords="${maxRecords}" startPosition="${startPosition}">
  <csw:Query typeNames="csw:Record">
    <csw:ElementSetName>full</csw:ElementSetName>
    <csw:Constraint version="1.1.0">
      <ogc:Filter>
        <ogc:PropertyIsGreaterThanOrEqualTo>
          <ogc:PropertyName>apiso:Modified</ogc:PropertyName>
          <ogc:Literal>${startDate}</ogc:Literal>
        </ogc:PropertyIsGreaterThanOrEqualTo>
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
 * @param {string} xmlText - Raw XML response
 * @returns {Promise<Object>} Parsed result with pagination info and records
 */
const parseGetRecordsResponse = (xmlText) => {
  const parser = sax.parser(true, { trim: true, normalize: true })

  const result = {
    pagination: {
      numberOfRecordsMatched: 0,
      numberOfRecordsReturned: 0,
      nextRecord: 0,
      hasMore: false,
    },
    records: [],
  }

  // State tracking
  let currentRecord = null
  let currentPath = []
  let textBuffer = ''

  parser.onerror = (err) => {
    throw new Error(`XML parsing error: ${err.message}`)
  }

  parser.onopentag = (node) => {
      currentPath.push(node.name)
      textBuffer = ''

      if (node.name === 'csw:SearchResults') {
        const attrs = node.attributes
        result.pagination.numberOfRecordsMatched = parseInt(attrs.numberOfRecordsMatched || '0', 10)
        result.pagination.numberOfRecordsReturned = parseInt(attrs.numberOfRecordsReturned || '0', 10)
        result.pagination.nextRecord = parseInt(attrs.nextRecord || '0', 10)
        result.pagination.hasMore =
          result.pagination.nextRecord > 0 &&
          result.pagination.nextRecord <= result.pagination.numberOfRecordsMatched
      } else if (node.name === 'gmd:MD_Metadata') {
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
      const pathStr = currentPath.join('/')

      if (currentRecord) {
        // Extract source URL from gmd:identificationInfo/*/gmd:citation/gmd:CI_Citation/gmd:identifier/gmd:MD_Identifier/gmd:code/gco:CharacterString
        if (pathStr.endsWith('gmd:citation/gmd:CI_Citation/gmd:identifier/gmd:MD_Identifier/gmd:code/gco:CharacterString')) {
          currentRecord.source = textBuffer.trim()
        }
        // Extract dateStamp
        else if (pathStr.endsWith('gmd:dateStamp/gco:DateTime') || pathStr.endsWith('gmd:dateStamp/gco:Date')) {
          currentRecord.dateStamp = textBuffer.trim()
        }
        // Extract title from identification info
        else if (pathStr.endsWith('gmd:citation/gmd:CI_Citation/gmd:title/gco:CharacterString')) {
          currentRecord.title = textBuffer.trim()
        }
      }

      if (name === 'gmd:MD_Metadata' && currentRecord) {
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
 * @param {Object} options
 * @param {string} options.endpoint - CSW endpoint URL
 * @param {string} options.startDate - ISO 8601 date string
 * @param {number} options.maxRecords - Maximum records per request
 * @param {number} options.startPosition - Starting position (1-based)
 * @returns {Promise<Object>} Result with records array and pagination info
 */
const fetchPage = async ({
  endpoint = DEFAULT_CSW_ENDPOINT,
  startDate,
  maxRecords = DEFAULT_MAX_RECORDS,
  startPosition = 1,
}) => {
  const xmlBody = buildGetRecordsXml({ startDate, maxRecords, startPosition })

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml',
    },
    body: xmlBody,
  })

  if (!response.ok) {
    throw new Error(`CSW request failed: ${response.status} ${response.statusText}`)
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
 * @param {Object} options
 * @param {string} options.endpoint - CSW endpoint URL
 * @param {string} options.startDate - ISO 8601 date string
 * @param {number} options.maxRecordsPerPage - Maximum records per request
 * @param {number} options.maxTotalRecords - Maximum total records to fetch (optional, for safety)
 * @param {Function} options.onPage - Optional callback called after each page: (pageResult, pageNumber) => void
 * @returns {Promise<Object>} Result with all records and summary
 */
const fetchAllRecords = async ({
  endpoint = DEFAULT_CSW_ENDPOINT,
  startDate,
  maxRecordsPerPage = DEFAULT_MAX_RECORDS,
  maxTotalRecords = Infinity,
  onPage = null,
}) => {
  const allRecords = []
  let startPosition = 1
  let pageNumber = 0
  let totalMatched = 0

  while (allRecords.length < maxTotalRecords) {
    pageNumber++

    const pageResult = await fetchPage({
      endpoint,
      startDate,
      maxRecords: Math.min(maxRecordsPerPage, maxTotalRecords - allRecords.length),
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

export {
  DEFAULT_CSW_ENDPOINT,
  fetchPage,
  fetchAllRecords,
}
