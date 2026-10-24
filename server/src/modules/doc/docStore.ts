import * as Y from 'yjs'
import type { Db, Sql } from '../../db'

/**
 * A shared document's history: Yjs updates appended as they come; every so many — merged into one state (the
 * updates it holds dropped). A document is the state plus the updates after it.
 */
export const DOC_MIGRATIONS = [
  `create table doc_updates (
     seq bigserial primary key,
     doc uuid not null references space_docs (id) on delete cascade,
     update bytea not null,
     author text not null references qa_devices (id),
     at timestamptz not null default now()
   );
   create index doc_updates_doc on doc_updates (doc, seq);
   create table doc_state (
     doc uuid primary key references space_docs (id) on delete cascade,
     state bytea not null,
     upto bigint not null
   );`,
]

/** Updates after the state before they are merged into it. */
export const COMPACT_EVERY = 200

/** Text of a document's state (for tests and checks). */
export const docText = (y: Y.Doc): string => y.getText('text').toString()

export class DocStore {
  constructor(private readonly db: Db) {}

  /** An update kept (in a transaction of the caller's, or on its own). */
  async append(doc: string, update: Uint8Array, author: string, sql: Sql = this.db): Promise<number> {
    const r = await sql.one<{ seq: number }>('insert into doc_updates (doc, update, author) values ($1, $2, $3) returning seq', [doc, Buffer.from(update), author])
    return r!.seq
  }
  /** The document as kept: its state, the updates after it applied. */
  async load(doc: string): Promise<{ y: Y.Doc; pending: number }> {
    const y = new Y.Doc()
    const st = await this.db.one<{ state: Buffer; upto: number }>('select state, upto from doc_state where doc = $1', [doc])
    if (st) Y.applyUpdate(y, st.state)
    const ups = await this.db.rows<{ update: Buffer }>('select update from doc_updates where doc = $1 and seq > $2 order by seq', [doc, st?.upto ?? 0])
    for (const u of ups) Y.applyUpdate(y, u.update)
    return { y, pending: ups.length }
  }
  /** The updates merged into the state (the document as `y` is now, up to the last update kept). */
  async compact(doc: string, y: Y.Doc): Promise<void> {
    await this.db.tx(async (sql) => {
      const last = await sql.one<{ seq: number | null }>('select max(seq) as seq from doc_updates where doc = $1', [doc])
      if (!last?.seq) return
      await sql.rows('insert into doc_state (doc, state, upto) values ($1, $2, $3) on conflict (doc) do update set state = excluded.state, upto = excluded.upto', [doc, Buffer.from(Y.encodeStateAsUpdate(y)), last.seq])
      await sql.rows('delete from doc_updates where doc = $1 and seq <= $2', [doc, last.seq])
    })
  }
}
