/**
 * CSW (Catalogue Service for the Web) Client
 * Works in both Cloudflare Workers and Node.js environments
 * Uses SAX streaming parser for memory efficiency
 */

import sax from 'sax';

const DEFAULT_CSW_ENDPOINT = 'https://gdk.gdi-de.org/geonetwork/srv/eng/csw';
const DEFAULT_MAX_RECORDS = 100;

/**
 * Build the XML request body for CSW GetRecords
 * @param {Object} options
 * @param {string} options.startDate - ISO 8601 date string (e.g., '2026-01-21T00:00:00Z')
 * @param {number} options.maxRecords - Maximum records per request
 * @param {number} options.startPosition - Starting position for pagination (1-based)
 * @returns {string} XML request body
 */
function buildGetRecordsXml({ startDate, maxRecords = DEFAULT_MAX_RECORDS, startPosition = 1 }) {
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
</csw:GetRecords>`;
}

/**
 * Strip namespace prefix from tag name
 * @param {string} name - Tag name potentially with namespace
 * @returns {string} Tag name without namespace prefix
 */
function stripNs(name) {
  const colonIndex = name.indexOf(':');
  return colonIndex >= 0 ? name.slice(colonIndex + 1) : name;
}

/**
 * Parse CSW GetRecords response using streaming SAX parser
 * @param {string} xmlText - Raw XML response
 * @returns {Promise<Object>} Parsed result with pagination info and records
 */
function parseGetRecordsResponse(xmlText) {
  return new Promise((resolve, reject) => {
    const parser = sax.parser(true, { trim: true, normalize: true });

    const result = {
      pagination: {
        numberOfRecordsMatched: 0,
        numberOfRecordsReturned: 0,
        nextRecord: 0,
        hasMore: false,
      },
      records: [],
    };

    // State tracking
    let currentRecord = null;
    let currentPath = [];
    let textBuffer = '';

    parser.onerror = (err) => {
      reject(new Error(`XML parsing error: ${err.message}`));
    };

    parser.onopentag = (node) => {
      const tagName = stripNs(node.name);
      currentPath.push(tagName);
      textBuffer = '';

      if (tagName === 'SearchResults') {
        // Extract pagination from attributes
        const attrs = node.attributes;
        for (const [key, value] of Object.entries(attrs)) {
          const attrName = stripNs(key);
          if (attrName === 'numberOfRecordsMatched') {
            result.pagination.numberOfRecordsMatched = parseInt(value, 10);
          } else if (attrName === 'numberOfRecordsReturned') {
            result.pagination.numberOfRecordsReturned = parseInt(value, 10);
          } else if (attrName === 'nextRecord') {
            result.pagination.nextRecord = parseInt(value, 10);
          }
        }
        result.pagination.hasMore =
          result.pagination.nextRecord > 0 &&
          result.pagination.nextRecord <= result.pagination.numberOfRecordsMatched;
      } else if (tagName === 'MD_Metadata') {
        // Start a new record
        currentRecord = {
          fileIdentifier: null,
          dateStamp: null,
          title: null,
        };
      }
    };

    parser.ontext = (text) => {
      textBuffer += text;
    };

    parser.oncdata = (cdata) => {
      textBuffer += cdata;
    };

    parser.onclosetag = (name) => {
      const tagName = stripNs(name);
      const pathStr = currentPath.join('/');

      if (currentRecord) {
        // Extract fileIdentifier
        if (pathStr.endsWith('fileIdentifier/CharacterString')) {
          currentRecord.fileIdentifier = textBuffer.trim();
        }
        // Extract dateStamp (can be Date or DateTime)
        else if (pathStr.endsWith('dateStamp/DateTime') || pathStr.endsWith('dateStamp/Date')) {
          currentRecord.dateStamp = textBuffer.trim();
        }
        // Extract title from identification info
        else if (
          pathStr.includes('identificationInfo') &&
          pathStr.includes('citation') &&
          pathStr.includes('CI_Citation') &&
          pathStr.endsWith('title/CharacterString')
        ) {
          currentRecord.title = textBuffer.trim();
        }
      }

      if (tagName === 'MD_Metadata' && currentRecord) {
        // Finished parsing a record
        result.records.push(currentRecord);
        currentRecord = null;
      }

      currentPath.pop();
      textBuffer = '';
    };

    parser.onend = () => {
      resolve(result);
    };

    parser.write(xmlText).close();
  });
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
async function fetchPage({
  endpoint = DEFAULT_CSW_ENDPOINT,
  startDate,
  maxRecords = DEFAULT_MAX_RECORDS,
  startPosition = 1,
}) {
  const xmlBody = buildGetRecordsXml({ startDate, maxRecords, startPosition });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml',
    },
    body: xmlBody,
  });

  if (!response.ok) {
    throw new Error(`CSW request failed: ${response.status} ${response.statusText}`);
  }

  const xmlText = await response.text();
  const { pagination, records } = await parseGetRecordsResponse(xmlText);

  return {
    records,
    pagination: {
      totalMatched: pagination.numberOfRecordsMatched,
      returned: pagination.numberOfRecordsReturned,
      nextRecord: pagination.nextRecord,
      hasMore: pagination.hasMore,
    },
  };
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
async function fetchAllRecords({
  endpoint = DEFAULT_CSW_ENDPOINT,
  startDate,
  maxRecordsPerPage = DEFAULT_MAX_RECORDS,
  maxTotalRecords = Infinity,
  onPage = null,
}) {
  const allRecords = [];
  let startPosition = 1;
  let pageNumber = 0;
  let totalMatched = 0;

  while (allRecords.length < maxTotalRecords) {
    pageNumber++;

    const pageResult = await fetchPage({
      endpoint,
      startDate,
      maxRecords: Math.min(maxRecordsPerPage, maxTotalRecords - allRecords.length),
      startPosition,
    });

    totalMatched = pageResult.pagination.totalMatched;
    allRecords.push(...pageResult.records);

    if (onPage) {
      onPage(pageResult, pageNumber);
    }

    if (!pageResult.pagination.hasMore) {
      break;
    }

    startPosition = pageResult.pagination.nextRecord;
  }

  // Find the latest dateStamp among all records
  let latestDateStamp = null;
  for (const record of allRecords) {
    if (record.dateStamp && (!latestDateStamp || record.dateStamp > latestDateStamp)) {
      latestDateStamp = record.dateStamp;
    }
  }

  return {
    records: allRecords,
    summary: {
      totalMatched,
      totalFetched: allRecords.length,
      pagesRequested: pageNumber,
      latestDateStamp,
    },
  };
}

/**
 * Create an async generator that yields records page by page
 * Useful for processing large result sets without loading all into memory
 * @param {Object} options - Same as fetchAllRecords
 * @yields {Object} Page result with records and pagination info
 */
async function* fetchRecordsGenerator({
  endpoint = DEFAULT_CSW_ENDPOINT,
  startDate,
  maxRecordsPerPage = DEFAULT_MAX_RECORDS,
  maxTotalRecords = Infinity,
}) {
  let startPosition = 1;
  let fetchedCount = 0;

  while (fetchedCount < maxTotalRecords) {
    const pageResult = await fetchPage({
      endpoint,
      startDate,
      maxRecords: Math.min(maxRecordsPerPage, maxTotalRecords - fetchedCount),
      startPosition,
    });

    fetchedCount += pageResult.records.length;
    yield pageResult;

    if (!pageResult.pagination.hasMore) {
      break;
    }

    startPosition = pageResult.pagination.nextRecord;
  }
}

// Export for ES modules
export {
  DEFAULT_CSW_ENDPOINT,
  DEFAULT_MAX_RECORDS,
  buildGetRecordsXml,
  parseGetRecordsResponse,
  fetchPage,
  fetchAllRecords,
  fetchRecordsGenerator,
};

export default {
  DEFAULT_CSW_ENDPOINT,
  DEFAULT_MAX_RECORDS,
  buildGetRecordsXml,
  parseGetRecordsResponse,
  fetchPage,
  fetchAllRecords,
  fetchRecordsGenerator,
};
