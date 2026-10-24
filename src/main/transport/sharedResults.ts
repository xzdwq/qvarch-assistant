import { RESULTS_PATH, TICKET_HEADER, type ResultsPage } from '../../shared/transport/protocol'
import type { SpacePasses } from './spacePasses'

/**
 * The run results of a shared note on the server (over HTTP, with the space's pass): this device's sent, what changed
 * since a number fetched.
 */
export class SharedResults {
  constructor(
    private readonly passes: SpacePasses,
    /** The server's HTTP address (`http://host:port`), none — offline. */
    private readonly base: () => string | undefined,
  ) {}

  private url(space: string, doc: string): string {
    const base = this.base()
    if (!base) throw new Error('Сервер не подключён')
    return `${base}${RESULTS_PATH}${space}/${doc}`
  }
  async put(space: string, doc: string, entries: Record<string, unknown>): Promise<void> {
    const body = JSON.stringify({ entries })
    const r = await this.passes.request(space, (pass) => fetch(this.url(space, doc), { method: 'PUT', body, headers: { [TICKET_HEADER]: pass, 'content-type': 'application/json' } }))
    if (!r.ok) throw new Error(`Результаты не отправлены: ${r.status} ${await r.text()}`)
  }
  async get(space: string, doc: string, since: number): Promise<ResultsPage> {
    const r = await this.passes.request(space, (pass) => fetch(`${this.url(space, doc)}?since=${since}`, { headers: { [TICKET_HEADER]: pass } }))
    if (!r.ok) throw new Error(`Результаты не получены: ${r.status}`)
    return (await r.json()) as ResultsPage
  }
}
