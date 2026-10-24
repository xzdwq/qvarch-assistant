import type { IncomingMessage, ServerResponse } from 'node:http'

/** The body of a request (too big — refused before it is all read: null). */
export function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) {
        req.destroy()
        ok(null)
      } else parts.push(c)
    })
    req.on('end', () => ok(Buffer.concat(parts)))
    req.on('error', fail)
  })
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
