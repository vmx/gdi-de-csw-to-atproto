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

#### Initial setup

1. Create a `.env` file with your Cloudflare credentials:
   ```
   CLOUDFLARE_ACCOUNT_ID=your-account-id
   CLOUDFLARE_API_TOKEN=your-api-token
   ```

2. Create a KV namespace:
   ```bash
   npx wrangler kv namespace create CSW_KV
   ```

3. Update `wrangler.jsonc` with the returned KV namespace ID (replace `PLACEHOLDER`).

4. Deploy:
   ```bash
   npm run deploy
   ```

The worker runs on a schedule (configured via Cron Triggers in `wrangler.jsonc`) and stores its last run timestamp in KV. On each run it fetches all records modified since the last run.

#### Debug endpoint

`GET /query` serves as a debug interface. Query parameters:

- `startDate` (required): ISO 8601 date (e.g., `2026-01-21T00:00:00Z`)
- `endDate`: ISO 8601 end date, exclusive
- `maxRecords`: Records per page (default: 100)
- `maxTotal`: Maximum total records
- `endpoint`: CSW endpoint URL

Example:
```
https://your-worker.workers.dev/query?startDate=2026-01-21T00:00:00Z&maxTotal=100
```

## Files

- `src/csw-client.ts` - Core library (platform-agnostic)
- `src/worker.ts` - Cloudflare Worker entry point
- `src/node-cli.ts` - Node.js CLI entry point

## License

MIT
