/**
 * The passes of the spaces for HTTP (media, run results): a space's pass kept a while (it is good for ten minutes —
 * asked once in a few minutes, not for every request); refused (the server restarted and signs anew, it ran out) —
 * forgotten, a new one asked and the request made once more.
 */
export class SpacePasses {
  private readonly kept = new Map<string, { t: string; until: number }>()
  constructor(
    private readonly ask: (space: string) => Promise<string>,
    private readonly keepMs = 5 * 60_000,
  ) {}

  private async pass(space: string): Promise<string> {
    const k = this.kept.get(space)
    if (k && k.until > Date.now()) return k.t
    const t = await this.ask(space)
    this.kept.set(space, { t, until: Date.now() + this.keepMs })
    return t
  }
  /** A request with the space's pass (a refusal of the pass — once more with a new one). */
  async request(space: string, send: (pass: string) => Promise<Response>): Promise<Response> {
    const r = await send(await this.pass(space))
    if (r.status !== 403) return r
    this.kept.delete(space)
    return send(await this.pass(space))
  }
}
