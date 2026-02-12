/**
 * Example: Using CSW Client for Scraping with State Management
 * 
 * This example shows how you might integrate the CSW client into a scraping
 * workflow where you track the latest record you've seen and fetch new records
 * since then.
 */

import {
  fetchAllRecords,
  fetchPage,
  fetchRecordsGenerator,
  DEFAULT_CSW_ENDPOINT,
} from './csw-client.js';

// ============================================================================
// Example 1: Simple one-shot fetch
// ============================================================================
async function exampleSimpleFetch() {
  console.log('=== Example 1: Simple Fetch ===\n');

  const result = await fetchAllRecords({
    startDate: '2026-01-21T00:00:00Z',
    maxRecordsPerPage: 50,
    maxTotalRecords: 100, // Safety limit
  });

  console.log(`Fetched ${result.summary.totalFetched} records`);
  console.log(`Total available: ${result.summary.totalMatched}`);
  console.log(`Latest dateStamp: ${result.summary.latestDateStamp}`);
  console.log('');
}

// ============================================================================
// Example 2: Pagination with progress callback
// ============================================================================
async function exampleWithProgress() {
  console.log('=== Example 2: Fetch with Progress ===\n');

  const result = await fetchAllRecords({
    startDate: '2026-01-21T00:00:00Z',
    maxRecordsPerPage: 25,
    maxTotalRecords: 75,
    onPage: (pageResult, pageNumber) => {
      console.log(`  Page ${pageNumber}: ${pageResult.records.length} records`);
    },
  });

  console.log(`\nTotal fetched: ${result.summary.totalFetched}`);
  console.log('');
}

// ============================================================================
// Example 3: Using the async generator for memory efficiency
// ============================================================================
async function exampleGenerator() {
  console.log('=== Example 3: Async Generator ===\n');

  const generator = fetchRecordsGenerator({
    startDate: '2026-01-21T00:00:00Z',
    maxRecordsPerPage: 25,
    maxTotalRecords: 50,
  });

  let pageNum = 0;
  for await (const page of generator) {
    pageNum++;
    console.log(`Processing page ${pageNum}...`);
    
    // Process records one at a time without loading all into memory
    for (const record of page.records) {
      // Do something with each record
      console.log(`  - ${record.fileIdentifier} (${record.dateStamp})`);
    }
  }
  console.log('');
}

// ============================================================================
// Example 4: Scraping workflow with state tracking
// ============================================================================

/**
 * This is a sketch of how you might use the client in a cron-like scraping setup.
 * You would implement loadState/saveState to persist to a file, database, or KV store.
 */
async function exampleScrapingWorkflow() {
  console.log('=== Example 4: Scraping Workflow ===\n');

  // In a real implementation, you'd load this from persistent storage
  let state = {
    lastSeenDateStamp: '2026-01-20T00:00:00Z',
    lastSeenFileIdentifier: null,
  };

  console.log(`Starting from: ${state.lastSeenDateStamp}`);

  // Fetch all records since last seen
  const result = await fetchAllRecords({
    startDate: state.lastSeenDateStamp,
    maxRecordsPerPage: 100,
    onPage: (pageResult, pageNumber) => {
      console.log(`  Fetched page ${pageNumber}`);
    },
  });

  // Filter out records we've already seen (by file identifier)
  // This handles the case where multiple records have the same timestamp
  const newRecords = result.records.filter((r) => {
    // If we have a lastSeenFileIdentifier, skip records until we pass it
    // (records are sorted by date ascending)
    if (state.lastSeenFileIdentifier && r.dateStamp === state.lastSeenDateStamp) {
      return r.fileIdentifier !== state.lastSeenFileIdentifier;
    }
    return true;
  });

  console.log(`\nFound ${newRecords.length} new records`);

  // Process new records
  for (const record of newRecords) {
    console.log(`  Processing: ${record.fileIdentifier}`);
    // Your processing logic here...
  }

  // Update state for next run
  if (newRecords.length > 0) {
    const lastRecord = newRecords[newRecords.length - 1];
    state = {
      lastSeenDateStamp: lastRecord.dateStamp,
      lastSeenFileIdentifier: lastRecord.fileIdentifier,
    };
    console.log(`\nUpdated state: lastSeen = ${state.lastSeenDateStamp}`);
    
    // In a real implementation, you'd save this to persistent storage:
    // await saveState(state);
  }
  console.log('');
}

// ============================================================================
// Example 5: Single page fetch (for manual pagination control)
// ============================================================================
async function exampleSinglePage() {
  console.log('=== Example 5: Single Page Fetch ===\n');

  // Fetch first page
  const page1 = await fetchPage({
    startDate: '2026-01-21T00:00:00Z',
    maxRecords: 10,
    startPosition: 1,
  });

  console.log(`Page 1: ${page1.records.length} records`);
  console.log(`Total available: ${page1.pagination.totalMatched}`);
  console.log(`Has more: ${page1.pagination.hasMore}`);
  console.log(`Next position: ${page1.pagination.nextRecord}`);

  // Fetch second page if there is one
  if (page1.pagination.hasMore) {
    const page2 = await fetchPage({
      startDate: '2026-01-21T00:00:00Z',
      maxRecords: 10,
      startPosition: page1.pagination.nextRecord,
    });
    console.log(`Page 2: ${page2.records.length} records`);
  }
  console.log('');
}

// ============================================================================
// Run examples
// ============================================================================
async function runExamples() {
  try {
    await exampleSimpleFetch();
    await exampleWithProgress();
    await exampleGenerator();
    await exampleScrapingWorkflow();
    await exampleSinglePage();
  } catch (error) {
    console.error('Error running examples:', error.message);
  }
}

// Uncomment to run:
// runExamples();

export {
  exampleSimpleFetch,
  exampleWithProgress,
  exampleGenerator,
  exampleScrapingWorkflow,
  exampleSinglePage,
  runExamples,
};
