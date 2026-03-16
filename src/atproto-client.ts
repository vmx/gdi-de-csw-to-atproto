// Minimal implementation of and ATProto client that can create records.

export interface AtpSession {
  accessJwt: string
  refreshJwt: string
  handle: string
  did: string
}

export interface AtpApplyWritesCreate {
  jwt: string
  repo: string
  writes: {
    $type: "com.atproto.repo.applyWrites#create"
    collection: string
    rkey: string
    value: unknown
  }[]
}

// TODO vmx 2026-01-21: add proper definition.
export interface AtpApplyWritesCreateResp {}

const PDS = process.env.ATP_PDS_URL ?? "https://bsky.social"

const logRateLimits = (resp: Response) => {
  const rateLimits: { [key: string]: string } = {}
  for (const [key, value] of resp.headers.entries()) {
    if (key.startsWith("ratelimit-")) {
      rateLimits[key.replace(/^ratelimit-/, "")] = value
    }
  }
  console.error(`${resp.status} Rate limits of ${resp.url}:`, JSON.stringify(rateLimits))
}

export async function atpCreateSession(
  identifier: string,
  password: string,
): Promise<AtpSession> {
  const url = new URL("/xrpc/com.atproto.server.createSession", PDS)
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier,
      password,
    }),
  })

  logRateLimits(resp)

  if (!resp.ok) {
    const err = await resp.text().catch(() => "(unknown error)")
    throw new Error(`Authentication failed: ${resp.status} ${err}`)
  }

  return resp.json() as Promise<AtpSession>
}

const RECORD_EXISTS_RETRIES = 3
const RECORD_EXISTS_RETRY_DELAY_MS = 2000

export async function atpRecordExists(
  repo: string,
  collection: string,
  rkey: string,
): Promise<boolean> {
  const url = new URL("/xrpc/com.atproto.repo.getRecord", PDS)
  url.searchParams.set("repo", repo)
  url.searchParams.set("collection", collection)
  url.searchParams.set("rkey", rkey)

  for (let attempt = 1; attempt <= RECORD_EXISTS_RETRIES; attempt++) {
    const resp = await fetch(url, { method: "HEAD" })

    logRateLimits(resp)

    if (resp.status === 200) return true
    if (resp.status === 400) return false

    if (resp.status >= 500 && attempt < RECORD_EXISTS_RETRIES) {
      console.error(
        `atpRecordExists: got ${resp.status} for ${rkey}, retrying (${attempt}/${RECORD_EXISTS_RETRIES})...`,
      )
      await new Promise((resolve) => setTimeout(resolve, RECORD_EXISTS_RETRY_DELAY_MS))
      continue
    }

    throw new Error(`atpRecordExists failed: unexpected status ${resp.status} for ${rkey}`)
  }

  // Unreachable, but TypeScript needs it
  throw new Error("atpRecordExists: exhausted retries")
}

export async function atpApplyWritesCreate({
  jwt,
  repo,
  writes,
}: AtpApplyWritesCreate): Promise<void> {
  const url = new URL("/xrpc/com.atproto.repo.applyWrites", PDS)
  const body = {
    repo,
    writes,
    validate: false,
  }

  const bodyStr = JSON.stringify(body)
  console.error(`applyWrites: ${writes.length} writes, ${Buffer.byteLength(bodyStr)} bytes`)
  console.error(`Posting rkeys: ${JSON.stringify(writes.map((w) => w.rkey))}`)

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: bodyStr,
  })

  logRateLimits(resp)

  if (resp.status === 413) {
    if (writes.length <= 1) {
      throw new Error("applyWrites failed: batch with a single write exceeds payload limit")
    }
    const mid = Math.ceil(writes.length / 2)
    console.error(`Payload too large, splitting batch into ${mid} + ${writes.length - mid}`)
    await atpApplyWritesCreate({ jwt, repo, writes: writes.slice(0, mid) })
    await atpApplyWritesCreate({ jwt, repo, writes: writes.slice(mid) })
    return
  }

  if (!resp.ok) {
    const err = await resp.text().catch(() => "(unknown error)")
    throw new Error(`applyWrites failed: ${resp.status} ${err}`)
  }
}
