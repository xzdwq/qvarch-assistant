import pg from 'pg'

/** Something to run SQL on: the pool, or one transaction's connection. */
export interface Sql {
  /** The rows of a query. */
  rows<R>(text: string, params?: unknown[]): Promise<R[]>
  /** Its first row (none — undefined). */
  one<R>(text: string, params?: unknown[]): Promise<R | undefined>
}

/** Bigints (sequence numbers, counts) read as numbers: a room never has 2^53 messages. */
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v))

const wrap = (q: pg.Pool | pg.PoolClient): Sql => ({
  rows: async <R>(text: string, params?: unknown[]) => (await q.query(text, params)).rows as R[],
  one: async <R>(text: string, params?: unknown[]) => (await q.query(text, params)).rows[0] as R | undefined,
})

/** The database: queries on the pool, transactions on one connection. */
export class Db implements Sql {
  readonly pool: pg.Pool
  private readonly sql: Sql

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 10, application_name: 'qvarch-transport' })
    // a connection the server dropped (a restart of the database) must not take the process down
    this.pool.on('error', (e) => console.error('db:', e.message))
    this.sql = wrap(this.pool)
  }
  rows<R>(text: string, params?: unknown[]): Promise<R[]> {
    return this.sql.rows<R>(text, params)
  }
  one<R>(text: string, params?: unknown[]): Promise<R | undefined> {
    return this.sql.one<R>(text, params)
  }
  /** `fn` in one transaction: committed when it returns, rolled back when it throws. */
  async tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    const c = await this.pool.connect()
    try {
      await c.query('begin')
      const r = await fn(wrap(c))
      await c.query('commit')
      return r
    } catch (e) {
      await c.query('rollback').catch(() => undefined)
      throw e
    } finally {
      c.release()
    }
  }
  close(): Promise<void> {
    return this.pool.end()
  }
}
