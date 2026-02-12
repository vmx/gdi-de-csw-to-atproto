# CSW Scraper

A CSW (Catalogue Service for the Web) client for scraping metadata records. Works in both Node.js and Cloudflare Workers.

## Features

- Fetch metadata records from CSW endpoints (OGC CSW 2.0.2)
- Filter by modification date
- Automatic pagination handling
- Streaming XML parsing (memory efficient)
- Configurable for both Node.js CLI and Cloudflare Workers

## Installation

```bash
npm install
```

## Usage

### Node.js CLI

```bash
# Fetch all records since a date
node node-cli.js --start-date 2026-01-21T00:00:00Z

# Limit results and save to file
node node-cli.js --start-date 2026-01-21T00:00:00Z --max-total 500 --outfile results.json

# Just get file identifiers
node node-cli.js --start-date 2026-01-21T00:00:00Z --output ids

# Use a different endpoint
node node-cli.js --start-date 2026-01-21T00:00:00Z --endpoint https://example.com/csw
```

### Programmatic Usage

```javascript
import { fetchAllRecords, fetchPage, fetchRecordsGenerator } from './csw-client.js';

// Fetch all records
const result = await fetchAllRecords({
  startDate: '2026-01-21T00:00:00Z',
  maxRecordsPerPage: 100,
  maxTotalRecords: 500,
  onPage: (page, num) => console.log(`Page ${num}: ${page.records.length} records`),
});

console.log(result.summary);
console.log(result.records);

// Or use the generator for memory efficiency
for await (const page of fetchRecordsGenerator({ startDate: '2026-01-21T00:00:00Z' })) {
  for (const record of page.records) {
    // Process each record
  }
}
```

### Cloudflare Worker

Deploy `worker.js` as your worker entry point. Query parameters:

- `startDate` (required): ISO 8601 date
- `maxRecords`: Records per page (default: 100)
- `maxTotal`: Maximum total records
- `endpoint`: CSW endpoint URL
- `page=single`: Fetch only one page
- `startPosition`: Starting position for pagination

Example:
```
https://your-worker.workers.dev/?startDate=2026-01-21T00:00:00Z&maxTotal=100
```

## Files

- `csw-client.js` - Core library (platform-agnostic)
- `worker.js` - Cloudflare Worker entry point
- `node-cli.js` - Node.js CLI entry point
- `examples.js` - Usage examples including scraping workflow

## Scraping Workflow

For periodic scraping (e.g., cron jobs):

1. Track the `latestDateStamp` from your last successful run
2. Query with that date as `startDate`
3. Use `fileIdentifier` to deduplicate records with the same timestamp
4. Update your tracked `latestDateStamp` after processing

See `examples.js` for a detailed example of this pattern.

## License

MIT
