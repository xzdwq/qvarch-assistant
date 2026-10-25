import { RESULTS_PATH, TICKET_HEADER, type ResultsPage, type ResultsPut, type ResultsPutReply } from '../../shared/transport/protocol'
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
  /** This device's results sent, each over the revision it was made over: what was taken, what the server has instead. */
  async put(space: string, doc: string, changes: ResultsPut['changes']): Promise<ResultsPutReply> {
    const body = JSON.stringify({ changes } satisfies ResultsPut)
    const r = await this.passes.request(space, (pass) => fetch(this.url(space, doc), { method: 'PUT', body, headers: { [TICKET_HEADER]: pass, 'content-type': 'application/json' } }))
    if (!r.ok) throw new Error(`Результаты не отправлены: ${r.status} ${await r.text()}`)
    return (await r.json()) as ResultsPutReply
  }
  async get(space: string, doc: string, since: number): Promise<ResultsPage> {
    const r = await this.passes.request(space, (pass) => fetch(`${this.url(space, doc)}?since=${since}`, { headers: { [TICKET_HEADER]: pass } }))
    if (!r.ok) throw new Error(`Результаты не получены: ${r.status}`)
    return (await r.json()) as ResultsPage
  }
}
