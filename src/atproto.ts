// Convenience layer on top of atproto-client.ts for use in GitHub Actions.
// Reads credentials from environment variables (GitHub secrets) and provides
// a simple interface for posting CSW records as cx.vmx.matadisco records
// with deterministic rkeys (the CSW identifier).

import {
  type AtpSession,
  atpApplyWrites,
  atpCreateSession,
  atpRecordExists,
} from "./atproto-client.ts"
import type { CswRecord } from "./csw-client.ts"

const COLLECTION = "cx.vmx.matadisco"

/**
 * Create a session using BLUESKY_IDENTIFIER and BLUESKY_PASSWORD env vars
 * (expected to be set from GitHub secrets).
 */
export const createSessionFromEnv = (): Promise<AtpSession> => {
  const identifier = process.env.BLUESKY_IDENTIFIER
  const password = process.env.BLUESKY_PASSWORD
  if (!identifier || !password) {
    throw new Error(
      "BLUESKY_IDENTIFIER and BLUESKY_PASSWORD environment variables are required",
    )
  }
  return atpCreateSession(identifier, password)
}

const metadataUrl = (endpoint: string, identifier: string): string =>
  `${endpoint}?service=CSW&version=2.0.2&request=GetRecordById&id=${encodeURIComponent(identifier)}&elementsetname=full&outputSchema=http://www.isotc211.org/2005/gmd`

const toWrite = (
  endpoint: string,
  r: CswRecord,
  $type: "com.atproto.repo.applyWrites#create" | "com.atproto.repo.applyWrites#update",
) => ({
  $type,
  collection: COLLECTION,
  rkey: r.identifier!,
  value: {
    metadata: metadataUrl(endpoint, r.identifier!),
    created: r.dateStamp,
    preview: r.abstract
      ? {
          mimeType: "text/markdown",
          data: r.title
            ? `# ${r.title}\n\n${r.abstract}`
            : r.abstract,
        }
      : undefined,
  },
})

/**
 * Post CSW records as cx.vmx.matadisco records with deterministic rkeys.
 * The CSW identifier is used as the rkey, making writes idempotent.
 * Records without an identifier are skipped.
 * Uses optimistic create: tries #create first, and on failure checks each
 * record with getRecord to determine which already exist, then retries
 * with the correct mix of #create and #update.
 */
export const putRecords = async (
  session: AtpSession,
  endpoint: string,
  records: CswRecord[],
) => {
  const validRecords = records.filter((r) => r.identifier !== null)
  const writes = validRecords.map((r) =>
    toWrite(endpoint, r, "com.atproto.repo.applyWrites#create"),
  )

  try {
    await atpApplyWrites({
      jwt: session.accessJwt,
      repo: session.did,
      writes,
    })
  } catch {
    console.error(
      "Batch create failed, checking which records already exist...",
    )

    const existing = await Promise.all(
      validRecords.map((r) =>
        atpRecordExists(session.did, COLLECTION, r.identifier!),
      ),
    )

    const retryWrites = validRecords.map((r, idx) =>
      toWrite(
        endpoint,
        r,
        existing[idx]
          ? "com.atproto.repo.applyWrites#update"
          : "com.atproto.repo.applyWrites#create",
      ),
    )

    const creates = existing.filter((e) => !e).length
    const updates = existing.filter((e) => e).length
    console.error(`Retrying batch: ${creates} creates, ${updates} updates`)

    await atpApplyWrites({
      jwt: session.accessJwt,
      repo: session.did,
      writes: retryWrites,
    })
  }
}
