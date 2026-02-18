Cloudflare Worker: Page-by-Page Cursor Approach
================================================

Context
-------

The GDI-DE CSW catalogue harvests other catalogues. This can cause bulk
updates of up to 50,000 records appearing at once. A single Cloudflare
Worker invocation on the free tier cannot handle this:

- 10ms CPU time limit (XML parsing of 50k records far exceeds this)
- No Queues or Durable Objects on the free tier

Design
------

Run the worker cron every 5 minutes. Each invocation processes exactly
one page of CSW records and stores a cursor in D1 so the next invocation
can resume.

Flow per invocation:

1. Read cursor from D1: `lastRun`, `pendingStartDate`, `pendingEndDate`,
   `pendingStartPosition`
2. If a pending job exists, fetch the next page from CSW using
   `pendingStartDate`/`pendingEndDate`/`pendingStartPosition`
3. If no pending job, compute the new window (`lastRun` → now) and fetch
   page 1
4. Process/post the page of records (e.g. to ATProto/Bluesky)
5. If `hasMore`, write the updated `startPosition` back to D1 and exit —
   next invocation continues from there
6. If done, write the new `lastRun` and clear the cursor

A 50k-record bulk update (100 records/page) takes ~500 invocations ×
5 minutes ≈ 42 hours to fully process. Records are posted to Bluesky in
small batches, which naturally stays within rate limits.

Why D1 over KV for cursor state
--------------------------------

| | KV | D1 |
|---|---|---|
| Write limit (free tier) | 1,000/day | 100,000/day |
| Read limit (free tier) | 100,000/day | 5M rows/day |

A 5-minute cron already consumes 288 writes/day just for heartbeat
updates. A 50k bulk update adds ~500 cursor writes on top. That exceeds
KV's 1,000/day limit but is well within D1's 100,000/day limit.

Open question
-------------

Whether 10ms CPU time is enough to SAX-parse one page (~100 records,
~500KB of XML) needs to be tested before committing to this design.
