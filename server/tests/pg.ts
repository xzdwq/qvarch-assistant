import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'

/** A free port of its own (the test files start their servers at once — one may take the port meanwhile). */
const freePort = () =>
  new Promise<number>((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port
      s.close(() => ok(p))
    })
  })

/** A PostgreSQL of a test file: its own folder and port, database `qa`; a port taken meanwhile — another one. */
export async function startPg(): Promise<{ url: string; stop: () => Promise<void> }> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await freePort()
    // UTF-8 as on the server (on Windows the default is the system's code page — no emoji there)
    const pg = new EmbeddedPostgres({ databaseDir: mkdtempSync(join(tmpdir(), 'qa-transport-')), user: 'postgres', password: 'pw', port, persistent: false, onLog: () => undefined, onError: () => undefined, initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-c', 'io_method=sync'] })
    try {
      await pg.initialise()
      await pg.start()
      await pg.createDatabase('qa')
      // (its folder may stay locked by Windows a moment after the stop: left in the temp folder then)
      return { url: `postgres://postgres:pw@127.0.0.1:${port}/qa`, stop: () => pg.stop().catch(() => undefined) }
    } catch (e) {
      last = e
      await pg.stop().catch(() => undefined)
    }
  }
  throw last
}
