import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const TICKET_MS = 10 * 60_000

/**
 * Passes for files over HTTP (a space's media and run results, a room's files): a member asks the socket for one, it
 * is good for some minutes and for its space (room) only. Signed by the server's key (`mediaSecret`; none — a random
 * one: a restart makes new ones, the apps ask again).
 */
export class Tickets {
  private readonly secret: Buffer
  constructor(secret: string) {
    this.secret = secret ? Buffer.from(secret) : randomBytes(32)
  }
  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url')
  }
  /** A pass of a device to a space (a room). */
  issue(space: string, device: string): string {
    const payload = `${space}.${device}.${Date.now() + TICKET_MS}`
    return `${payload}.${this.sign(payload)}`
  }
  /** The device a pass is of, for this space (none — not a valid one). */
  deviceOf(ticket: string | undefined, space: string): string | undefined {
    const parts = (ticket ?? '').split('.')
    if (parts.length !== 4 || parts[0] !== space || Number(parts[2]) < Date.now()) return undefined
    const want = Buffer.from(this.sign(parts.slice(0, 3).join('.')))
    const got = Buffer.from(parts[3])
    return got.length === want.length && timingSafeEqual(got, want) ? parts[1] : undefined
  }
}
