// Convenience layer on top of atproto-client.ts for use in GitHub Actions.
// Reads credentials from environment variables (GitHub secrets) and provides
// a simple interface for posting CSW records as cx.vmx.matadisco records
// with deterministic rkeys (identifier + dateStamp).

import {
  type AtpSession,
  atpApplyWritesCreate,
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

const toRkey = (r: CswRecord): string => {
  const safeId = r.identifier!.replace(/[^A-Za-z0-9._:~-]/g, "_")
  const dateDigits = (r.dateStamp ?? "").replace(/\D/g, "")
  return `${safeId}.${dateDigits}`
}

const toWrite = (endpoint: string, r: CswRecord) => ({
  $type: "com.atproto.repo.applyWrites#create" as const,
  collection: COLLECTION,
  rkey: toRkey(r),
  value: {
    metadata: metadataUrl(endpoint, r.identifier!),
    created: r.dateStamp,
    preview: r.abstract
      ? {
          mimeType: "text/plain",
          data: r.title
            ? `${r.title}\n\n${r.abstract}`
            : r.abstract,
        }
      : undefined,
  },
})

/**
 * Post CSW records as cx.vmx.matadisco records with deterministic rkeys.
 * The rkey is identifier + dateStamp digits, so each version of a record
 * gets its own rkey. Retrying the same data is idempotent.
 * Records without an identifier are skipped.
 *
 * Uses optimistic create: tries #create first, and on failure filters out
 * records that already exist, then retries with only the new ones.
 */
export const putRecords = async (
  session: AtpSession,
  endpoint: string,
  records: CswRecord[],
) => {
  const validRecords = records.filter((r) => r.identifier !== null)
  const writes = validRecords.map((r) => toWrite(endpoint, r))

  try {
    await atpApplyWritesCreate({
      jwt: session.accessJwt,
      repo: session.did,
      writes,
    })
  } catch (err) {
    console.error(
      `Batch create failed: ${err instanceof Error ? err.message : err}`,
    )
    console.error("Checking which records already exist...")

    const existing = await Promise.all(
      validRecords.map((r) =>
        atpRecordExists(session.did, COLLECTION, toRkey(r)),
      ),
    )

    const newWrites = writes.filter((_, idx) => !existing[idx])
    console.error(
      `${existing.filter((e) => e).length} already exist, retrying ${newWrites.length} new records`,
    )

    if (newWrites.length > 0) {
      await atpApplyWritesCreate({
        jwt: session.accessJwt,
        repo: session.did,
        writes: newWrites,
      })
    }
  }
}
