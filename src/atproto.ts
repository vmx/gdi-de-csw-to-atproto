// Convenience layer on top of atproto-client.ts for use in GitHub Actions.
// Reads credentials from environment variables (GitHub secrets) and provides
// a simple interface for posting CSW records as cx.vmx.matadisco records
// with deterministic rkeys (the CSW identifier).

import {
  type AtpSession,
  atpApplyWritesCreate,
  atpCreateSession,
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

/**
 * Post CSW records as cx.vmx.matadisco records with deterministic rkeys.
 * The CSW identifier is used as the rkey, making writes idempotent.
 * Records without an identifier are skipped.
 */
export const putRecords = (
  session: AtpSession,
  endpoint: string,
  records: CswRecord[],
) =>
  atpApplyWritesCreate({
    jwt: session.accessJwt,
    repo: session.did,
    writes: records
      .filter((r) => r.identifier !== null)
      .map((r) => ({
        $type: "com.atproto.repo.applyWrites#create" as const,
        collection: COLLECTION,
        rkey: r.identifier,
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
      })),
  })
