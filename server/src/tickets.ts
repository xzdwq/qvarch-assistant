import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Passes for a space's files over HTTP (media, run results): a member asks the socket for one, it is good for some
 * minutes and for its space only. Signed by the server (QA_MEDIA_SECRET — several servers share it; none — a restart
 * makes new ones, the apps ask again).
 */
const TICKET_MS = 10 * 60_000
const secret = process.env.QA_MEDIA_SECRET ? Buffer.from(process.env.QA_MEDIA_SECRET) : randomBytes(32)
const sign = (payload: string) => createHmac('sha256', secret).update(payload).digest('base64url')

export function ticketOf(space: string, device: string): string {
  const payload = `${space}.${device}.${Date.now() + TICKET_MS}`
  return `${payload}.${sign(payload)}`
}
/** The device a pass is of, for this space (none — not a valid one). */
export function passOf(ticket: string | undefined, space: string): string | undefined {
  const parts = (ticket ?? '').split('.')
  if (parts.length !== 4 || parts[0] !== space || Number(parts[2]) < Date.now()) return undefined
  const want = Buffer.from(sign(parts.slice(0, 3).join('.')))
  const got = Buffer.from(parts[3])
  return got.length === want.length && timingSafeEqual(got, want) ? parts[1] : undefined
}
