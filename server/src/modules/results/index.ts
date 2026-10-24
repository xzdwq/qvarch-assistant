import type { IncomingMessage, ServerResponse } from 'node:http'
import { RESULTS_MAX, RESULTS_PATH, TICKET_HEADER, type ResultsPage } from '../../../../src/shared/transport/protocol'
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
]
/** A key of a result as the app writes it (`run:…`, `loop:…`, `ctx:…`; a set's name may be in any letters). */
const KEY = /^(run|loop|ctx):[^\u0000-\u001f]{1,300}$/
const UUID = /^[0-9a-f-]{36}$/
/** When a result was run (its `at`, epoch ms; none — 0). */
const ranAt = (v: unknown): number => {
  const at = (v as { at?: unknown } | null)?.at
  return typeof at === 'number' && Number.isFinite(at) ? Math.trunc(at) : 0
}

/**
 * The run results of the shared notes: whoever runs a block, everyone sees its result (a query to one's own database,
 * a request, a browser run…). A result is kept by its key, the newest wins; everyone in the space is told a change
 * came (by its number) and fetches what changed since what they had. Over HTTP — results may be large.
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
      const rows = await ctx.db.rows<{ key: string; data: string | null; device: string; name: string; at: number; seq: number }>(
        `select r.key, r.data, r.device, d.name, (extract(epoch from r.at) * 1000)::bigint as at, r.seq
         from doc_results r join qa_devices d on d.id = r.device where r.doc = $1 and r.seq > $2 order by r.seq`,
        [doc, since],
      )
      const page: ResultsPage = { seq: rows.reduce((m, r) => Math.max(m, r.seq), since), entries: {} }
      for (const r of rows) page.entries[r.key] = { value: r.data === null ? null : JSON.parse(r.data), by: r.name, device: r.device, at: Number(r.at) }
      return replyJson(res, page)
    }
    if (req.method === 'PUT') {
      if (!ROLE_RIGHTS[role].edit) return reply(res, 403, 'только чтение')
      const body = await readBody(req, RESULTS_MAX)
      if (!body) return reply(res, 413, 'результат слишком большой')
      let entries: Record<string, unknown>
      try {
        entries = (JSON.parse(body.toString('utf8')) as { entries: Record<string, unknown> }).entries
      } catch {
        return reply(res, 400, 'не JSON')
      }
      const keys = Object.keys(entries ?? {}).filter((k) => KEY.test(k))
      if (!keys.length) return reply(res, 204)
      let seq = 0
      await ctx.db.tx(async (sql) => {
        for (const k of keys) {
          const v = entries[k]
          const gone = v === null || v === undefined
          // a result run earlier than the one kept (sent late — the device was offline) does not replace it
          const r = await sql.one<{ seq: number }>(
            `insert into doc_results (doc, key, data, device, ran_at) values ($1, $2, $3, $4, $5)
             on conflict (doc, key) do update set data = excluded.data, device = excluded.device, ran_at = excluded.ran_at, at = now(), seq = nextval('doc_results_seq')
               where excluded.data is null or excluded.ran_at >= doc_results.ran_at
             returning seq`,
            [doc, k, gone ? null : JSON.stringify(v), device, gone ? 0 : ranAt(v)],
          )
          if (r) seq = Math.max(seq, r.seq)
        }
      })
      if (seq) ctx.delivery.send(await spaces.members(space), { e: 'doc.results', p: { doc, seq, by: device } })
      return reply(res, 204)
    }
    return reply(res, 405)
  }

  return { name: 'results', migrations: RESULTS_MIGRATIONS, http }
}
