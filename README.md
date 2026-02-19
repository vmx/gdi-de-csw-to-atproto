gdi-de-csw-to-atproto
=====================

A CSW (Catalogue Service for the Web) client for scraping INSPIRE metadata records. Works in both Node.js and Cloudflare Workers.

Features
--------

- Fetch metadata records from CSW endpoints (OGC CSW 2.0.2)
- Filter by modification date
- Automatic pagination handling
- Streaming XML parsing (memory efficient)
- Configurable for both Node.js CLI and Cloudflare Workers

Installation
------------

```bash
npm install
```

Node.js CLI
-----------

```bash
# Fetch all records since a date
node src/node-cli.ts --start-date 2026-01-21T00:00:00Z

# Limit results and save to file
node src/node-cli.ts --start-date 2026-01-21T00:00:00Z --max-total 500 --outfile results.json

# Use a different endpoint
node src/node-cli.ts --start-date 2026-01-21T00:00:00Z --endpoint https://example.com/csw
```

GitHub Actions Sync
-------------------

The sync workflow (`.github/workflows/sync.yml`) runs every 15 minutes.
It fetches up to 10 pages of 200 CSW records per run, with a 1-minute
pause between pages. The cursor (last run timestamp + pagination position)
is stored as a GitHub repository variable `CSW_CURSOR` — no commits needed.

If a bulk update produces more records than one run can handle, the cursor
saves the position and the next run resumes from there automatically.

Cloudflare Worker
-----------------

### Initial setup

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

### Development

To run the worker locally:

    npm run dev

`GET /query` serves as a debug interface. Query parameters:

- `startDate` (required): ISO 8601 date (e.g., `2026-01-21T00:00:00Z`)
- `endDate`: ISO 8601 end date, exclusive
- `maxRecords`: Records per page (default: 100)
- `startPosition`: Starting position, 1-based (returns a single page instead of all pages)
- `endpoint`: CSW endpoint URL

Examples:
```
# Fetch all records since a date
https://your-worker.workers.dev/query?startDate=2026-01-21T00:00:00Z

# Fetch a single page of 10 records starting at position 1 (the first page)
https://your-worker.workers.dev/query?startDate=2026-01-21T00:00:00Z&maxRecords=10&startPosition=1
```

When changing the `wrangler.jsonc` configuration, re-run the types generator:

    npm run cf-typegen


### Deployment

Deploy it to Cloudflare:

     npm run deploy


Backfill
--------

To simulate the scheduled worker over a historical date range, use `backfill.sh`.
It splits the range into 6-hour windows and runs the CLI for each one:

```bash
./backfill.sh --start-date 2026-01-01 --end-date 2026-02-01
```

Each window's JSON result is written to stdout; progress is logged to stderr.

Files
-----

- `src/csw-client.ts` - Core library (platform-agnostic)
- `src/worker.ts` - Cloudflare Worker entry point
- `src/node-cli.ts` - Node.js CLI entry point
- `src/sync.ts` - GitHub Actions sync entry point
- `backfill.sh` - Backfill script simulating the scheduled worker

License
-------

MIT
