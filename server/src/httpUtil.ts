import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * The body of a request (too big — null: refused by its declared length before reading, else as soon as it
 * passes the limit; the rest is drained, not kept, so the refusal can still be answered on the same socket).
 */
export function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((ok, fail) => {
    if (Number(req.headers['content-length']) > max) {
      req.resume()
      return ok(null)
    }
    const parts: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      if ((size += c.length) <= max) return void parts.push(c)
      parts.length = 0
      ok(null)
    })
    req.on('end', () => size <= max && ok(Buffer.concat(parts)))
    req.on('error', fail)
  })
}
/** A URL's / a header's encoded text (broken encoding — as it came, never a thrown error). */
export function decoded(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
/** A short answer — the request taken. */
export function reply(res: ServerResponse, code: number, text = ''): true {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }).end(text)
  return true
}
/** A JSON answer — the request taken. */
export function replyJson(res: ServerResponse, body: unknown): true {
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length }).end(data)
  return true
}
