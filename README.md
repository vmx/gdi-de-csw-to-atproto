gdi-de-csw-to-atproto
=====================

CSW client for syncing GDI-DE INSPIRE metadata to ATProto.

Features
--------

- Fetch metadata records from CSW endpoints (OGC CSW 2.0.2)
- Filter by modification date
- Automatic pagination handling
- Streaming XML parsing (memory efficient)

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

Two workflows handle syncing, sharing a concurrency group so they never
run simultaneously:

- **sync** (`.github/workflows/sync.yml`) — runs every 6 hours, fetches
  one page of 200 records. If there are more, it enables the trickle
  workflow.
- **trickle** (`.github/workflows/trickle.yml`) — starts disabled, runs
  every 15 minutes when enabled. Processes up to 10 pages of 200 records
  per run with 1-minute pauses between pages. Disables itself when done.

The cursor (last run timestamp + pagination position) is stored as a
GitHub repository variable `CSW_CURSOR` — no commits needed.

Set `TIME_OFFSET_DAYS` to shift "now" back by a number of days, useful
for simulating past runs (e.g. `TIME_OFFSET_DAYS=14` to replay activity
from two weeks ago).

Backfill
--------

To query CSW over a historical date range, use `backfill.sh`.
It splits the range into 6-hour windows and runs the CLI for each one:

```bash
./backfill.sh --start-date 2026-01-01 --end-date 2026-02-01
```

Each window's JSON result is written to stdout; progress is logged to stderr.

Files
-----

- `src/csw-client.ts` - Core library (platform-agnostic)
- `src/node-cli.ts` - Node.js CLI entry point
- `src/sync.ts` - GitHub Actions sync entry point (used by both sync and trickle workflows)
- `backfill.sh` - Backfill script for historical date ranges

Development
-----------

This project was built as an exploration of AI-assisted software development,
using AI coding assistants extensively to learn what's possible today.

License
-------

This project is licensed under either of

 - Apache License, Version 2.0, ([LICENSE-APACHE] or https://www.apache.org/licenses/LICENSE-2.0)
 - MIT license ([LICENSE-MIT] or https://opensource.org/licenses/MIT)

at your option.


[LICENSE-APACHE]: ./LICENSE-APACHE
[LICENSE-MIT]: ./LICENSE-MIT
