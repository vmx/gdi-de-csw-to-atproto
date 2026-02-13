# CSW Scraper

A CSW (Catalogue Service for the Web) client for scraping INSPIRE metadata records. Works in both Node.js and Cloudflare Workers.

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
node src/node-cli.ts --start-date 2026-01-21T00:00:00Z

# Limit results and save to file
node src/node-cli.ts --start-date 2026-01-21T00:00:00Z --max-total 500 --outfile results.json

# Just get source URLs
node src/node-cli.ts --start-date 2026-01-21T00:00:00Z --output ids

# Use a different endpoint
node src/node-cli.ts --start-date 2026-01-21T00:00:00Z --endpoint https://example.com/csw
```

### Cloudflare Worker

Deploy `src/worker.ts` as your worker entry point. Query parameters:

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

- `src/csw-client.ts` - Core library (platform-agnostic)
- `src/worker.ts` - Cloudflare Worker entry point
- `src/node-cli.ts` - Node.js CLI entry point

## License

MIT
