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

const PDS = "https://bsky.social"

const logRateLimits = (resp: Response) => {
  const rateLimits: { [key: string]: string } = {}
  for (const [key, value] of resp.headers.entries()) {
    if (key.startsWith("ratelimit-")) {
      rateLimits[key.replace(/^ratelimit-/, "")] = value
    }
  }
  console.error(`Rate limits of ${resp.url}:`, JSON.stringify(rateLimits))
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

export async function atpRecordExists(
  repo: string,
  collection: string,
  rkey: string,
): Promise<boolean> {
  const url = new URL("/xrpc/com.atproto.repo.getRecord", PDS)
  url.searchParams.set("repo", repo)
  url.searchParams.set("collection", collection)
  url.searchParams.set("rkey", rkey)

  const resp = await fetch(url, { method: "HEAD" })

  logRateLimits(resp)

  if (resp.status === 200) return true
  if (resp.status === 400) return false

  throw new Error(`atpRecordExists failed: unexpected status ${resp.status}`)
}

export async function atpApplyWritesCreate({
  jwt,
  repo,
  writes,
}: AtpApplyWritesCreate): Promise<AtpApplyWritesCreateResp> {
  const url = new URL("/xrpc/com.atproto.repo.applyWrites", PDS)
  const body = {
    repo,
    writes,
    validate: false,
  }

  const bodyStr = JSON.stringify(body)
  console.error(`applyWrites: ${writes.length} writes, ${Buffer.byteLength(bodyStr)} bytes`)

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: bodyStr,
  })

  logRateLimits(resp)

  if (!resp.ok) {
    const err = await resp.text().catch(() => "(unknown error)")
    throw new Error(`applyWrites failed: ${resp.status} ${err}`)
  }

  return resp.json() as Promise<AtpApplyWritesCreateResp>
}
