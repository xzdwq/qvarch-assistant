import type { IncomingMessage, ServerResponse } from 'node:http'
import { RESULTS_MAX, RESULTS_PATH, TICKET_HEADER, type ResultsPage, type ResultsPut, type ResultsPutReply, type SharedResult } from '../../../../src/shared/transport/protocol'
import { isResultKey } from '../../../../src/shared/transport/results'
import type { Sql } from '../../db'
import { ROLE_RIGHTS } from '../../../../src/shared/transport/space'
import { readBody, reply, replyJson } from '../../httpUtil'
import type { ModuleFactory } from '../../module'
import { passOf } from '../../tickets'
import { SpaceStore } from '../space/spaceStore'

const RESULTS_MIGRATIONS = [
  `create sequence doc_results_seq;
   create table doc_results (
     doc uuid not null references space_docs (id) on delete cascade,
     key text not null,
     data text,
     device text not null references qa_devices (id),
     at timestamptz not null default now(),
     ran_at bigint not null default 0,
     seq bigint not null default nextval('doc_results_seq'),
     primary key (doc, key)
   );
   create index doc_results_seq_idx on doc_results (doc, seq);`,
  // the order is the server's (revisions, its clock): a device's clock decides nothing
  'alter table doc_results drop column ran_at;',
]
const UUID = /^[0-9a-f-]{36}$/
/** A result row as the others get it. */
interface ResultRow {
  key: string
  data: string | null
  device: string
  name: string
  at: number
  seq: number
}
const RESULT_COLS = `r.key, r.data, r.device, d.name, (extract(epoch from r.at) * 1000)::bigint as at, r.seq`
const asResult = (r: ResultRow): SharedResult => ({ value: r.data === null ? null : JSON.parse(r.data), by: r.name, device: r.device, at: Number(r.at), seq: Number(r.seq) })

/**
 * The run results of the shared notes: whoever runs a block, everyone sees its result (a query to one's own database,
 * a request, a browser run…). Their order is the server's alone — each result a revision (a number given as it
 * arrives) and the server's time: no computer's clock or time zone decides. A result is taken over the revision it
 * was made over only — something newer came meanwhile (someone ran it while this device was offline): not taken, the
 * newer one answered. Everyone in the space is told a change came (by its number) and fetches what changed since.
 * Over HTTP — results may be large.
 */
export const resultsModule: ModuleFactory = (ctx) => {
  const spaces = new SpaceStore(ctx.db)

  async function http(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!req.url?.startsWith(RESULTS_PATH)) return false
    const url = new URL(req.url, 'http://x')
    const [space, doc] = url.pathname.slice(RESULTS_PATH.length).split('/')
    if (!UUID.test(space ?? '') || !UUID.test(doc ?? '')) return reply(res, 400, 'неверный путь')
    const device = passOf(req.headers[TICKET_HEADER] as string | undefined, space)
    const role = device && (await spaces.roleOf(space, device))
    if (!device || !role || (await spaces.docSpace(doc)) !== space) return reply(res, 403, 'нет доступа')
    if (req.method === 'GET') {
      const since = Number(url.searchParams.get('since')) || 0
      const rows = await ctx.db.rows<ResultRow>(`select ${RESULT_COLS} from doc_results r join qa_devices d on d.id = r.device where r.doc = $1 and r.seq > $2 order by r.seq`, [doc, since])
      const page: ResultsPage = { seq: rows.reduce((m, r) => Math.max(m, Number(r.seq)), since), entries: {} }
      for (const r of rows) page.entries[r.key] = asResult(r)
      return replyJson(res, page)
    }
    if (req.method === 'PUT') {
      if (!ROLE_RIGHTS[role].edit) return reply(res, 403, 'только чтение')
      const body = await readBody(req, RESULTS_MAX)
      if (!body) return reply(res, 413, 'результат слишком большой')
      let changes: ResultsPut['changes']
      try {
        changes = (JSON.parse(body.toString('utf8')) as ResultsPut).changes
      } catch {
        return reply(res, 400, 'не JSON')
      }
      const keys = Object.keys(changes ?? {}).filter(isResultKey)
      const answer: ResultsPutReply = { accepted: {}, current: {} }
      await ctx.db.tx(async (sql) => {
        for (const k of keys) {
          const r = await take(sql, doc, k, changes[k], device)
          if (r !== undefined) answer.accepted[k] = r
          else answer.current[k] = asResult((await sql.one<ResultRow>(`select ${RESULT_COLS} from doc_results r join qa_devices d on d.id = r.device where r.doc = $1 and r.key = $2`, [doc, k]))!)
        }
      })
      const seq = Math.max(0, ...Object.values(answer.accepted))
      if (seq) ctx.delivery.send(await spaces.members(space), { e: 'doc.results', p: { doc, seq, by: device } })
      return replyJson(res, answer)
    }
    return reply(res, 405)
  }

  return { name: 'results', migrations: RESULTS_MIGRATIONS, http }
}

/**
 * A result taken — when nothing newer than its base is kept (none kept — always): its new revision; else undefined.
 * One statement: two sends of the same key at once cannot both pass.
 */
async function take(sql: Sql, doc: string, key: string, change: { value?: unknown; base?: unknown } | undefined, device: string): Promise<number | undefined> {
  const value = change?.value
  const base = typeof change?.base === 'number' && Number.isFinite(change.base) ? change.base : 0
  const r = await sql.one<{ seq: number }>(
    `insert into doc_results (doc, key, data, device) values ($1, $2, $3, $4)
     on conflict (doc, key) do update set data = excluded.data, device = excluded.device, at = now(), seq = nextval('doc_results_seq')
       where doc_results.seq <= $5
     returning seq`,
    [doc, key, value === null || value === undefined ? null : JSON.stringify(value), device, base],
  )
  return r ? Number(r.seq) : undefined
}
