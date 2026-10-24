import type { Db } from './db'

/** A key of the advisory lock the migrations take (two servers starting at once — one migrates, the other waits). */
const MIGRATE_LOCK = 7_253_001

/** The steps of a module not applied yet: its numbers after the last one done. */
export function pendingSteps(done: number, steps: readonly string[]): Array<{ version: number; sql: string }> {
  return steps.map((sql, i) => ({ version: i + 1, sql })).filter((s) => s.version > done)
}

/** Every module's schema brought up to date, in the registry's order (a module may refer to the tables of one before it). */
export async function migrate(db: Db, modules: ReadonlyArray<{ name: string; migrations: readonly string[] }>): Promise<string[]> {
  const applied: string[] = []
  const c = await db.pool.connect()
  try {
    await c.query('select pg_advisory_lock($1)', [MIGRATE_LOCK])
    await c.query('create table if not exists qa_migrations (module text not null, version int not null, at timestamptz not null default now(), primary key (module, version))')
    for (const m of modules) {
      const done = Number((await c.query('select coalesce(max(version), 0) as v from qa_migrations where module = $1', [m.name])).rows[0].v)
      for (const step of pendingSteps(done, m.migrations)) {
        await c.query('begin')
        try {
          await c.query(step.sql)
          await c.query('insert into qa_migrations (module, version) values ($1, $2)', [m.name, step.version])
          await c.query('commit')
        } catch (e) {
          await c.query('rollback')
          throw new Error(`миграция ${m.name} #${step.version}: ${(e as Error).message}`)
        }
        applied.push(`${m.name}#${step.version}`)
      }
    }
  } finally {
    await c.query('select pg_advisory_unlock($1)', [MIGRATE_LOCK]).catch(() => undefined)
    c.release()
  }
  return applied
}
