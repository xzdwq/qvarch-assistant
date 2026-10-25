import { describe, expect, it } from 'vitest'
import type { ResultsPage, ResultsPut, ResultsPutReply, SharedResult } from '../../src/shared/transport/protocol'
import type { NoteRun } from '../../src/notebook/engine/runTypes'
import { runEntries } from '../../src/notebook/engine/sharedRuns'
import { changesToSend, markOwn, receive, settle } from '../../src/notebook/engine/resultSync'

/**
 * The server's rule, as the results module keeps it: a result taken over the revision it was made over only; each
 * taken one — the next revision and the server's time (its own clock: a counter here).
 */
class FakeServer {
  private rows = new Map<string, SharedResult>()
  private seq = 0
  private clock = 1_000
  put(changes: ResultsPut['changes'], device: string, by: string): ResultsPutReply {
    const out: ResultsPutReply = { accepted: {}, current: {} }
    for (const [key, c] of Object.entries(changes)) {
      const had = this.rows.get(key)
      if (had && had.seq > c.base) out.current[key] = had
      else {
        this.rows.set(key, { value: c.value, by, device, at: (this.clock += 10), seq: ++this.seq })
        out.accepted[key] = this.seq
      }
    }
    return out
  }
  page(since: number): ResultsPage {
    const entries = Object.fromEntries([...this.rows].filter(([, r]) => r.seq > since))
    return { seq: Math.max(since, ...[...this.rows.values()].map((r) => r.seq)), entries }
  }
  value(key: string): unknown {
    return this.rows.get(key)?.value
  }
}

/** A device with a shared note: its runs, what it fetched, its way of syncing (as sharedRunResults does it). */
class Device {
  n: NoteRun = { ctx: {}, runs: {}, loops: {}, loaded: true, sync: {} }
  since = 0
  constructor(
    readonly id: string,
    readonly name: string,
    private readonly server: FakeServer,
  ) {}
  run(key: string, at: number, rows: number): void {
    this.n.runs[key] = { state: 'ok', at, table: { columns: [], rows: Array.from({ length: rows }, () => []), more: false, ms: 1 } }
    markOwn(this.n, this.n.sync!, runEntries(this.n))
  }
  fetch(): void {
    const page = this.server.page(this.since)
    for (const [k, r] of Object.entries(page.entries)) receive(this.n, this.n.sync!, k, r, this.id)
    this.since = page.seq
  }
  send(): void {
    const now = runEntries(this.n)
    markOwn(this.n, this.n.sync!, now)
    const changes = changesToSend(this.n.sync!, now)
    if (Object.keys(changes).length) settle(this.n, this.n.sync!, this.server.put(changes, this.id, this.name), this.id)
  }
  /** Online again / opened: what came meanwhile first, then what it made. */
  bringIntoStep(): void {
    this.fetch()
    this.send()
  }
  rowsOf(name: string): number | undefined {
    return this.n.runs[name]?.table?.rows.length
  }
}
const pair = () => {
  const server = new FakeServer()
  return { server, a: new Device('dev-a', 'Альфа', server), b: new Device('dev-b', 'Бета', server) }
}

describe('a shared note\'s results ordered by the server', () => {
  it('one runs — the others get it, marked who ran it, at the server\'s time', () => {
    const { a, b } = pair()
    a.run('q', 5, 3)
    a.send()
    b.fetch()
    expect(b.rowsOf('q')).toBe(3)
    expect(b.n.runs.q.by).toBe('Альфа')
    expect(b.n.runs.q.at).toBe(1010)
  })

  it('run offline, someone ran it meanwhile — the newer one wins at both, whichever comes first', () => {
    const { server, a, b } = pair()
    a.run('q', 1, 1)
    a.send()
    b.fetch()
    // Бета offline: runs it over what she has
    b.run('q', 2, 2)
    // meanwhile Альфа runs it again, online
    a.run('q', 3, 3)
    a.send()
    // Бета back: what came meanwhile first — Альфа's newer result is shown, hers is not sent
    b.bringIntoStep()
    expect([b.rowsOf('q'), (server.value('run:q') as { table: { rows: unknown[] } }).table.rows.length]).toEqual([3, 3])
    expect(b.n.sync!['run:q'].pending).toBe(false)
  })

  it('…and sent before the fetch: the server refuses it and answers with the newer one', () => {
    const { server, a, b } = pair()
    a.run('q', 1, 1)
    a.send()
    b.fetch()
    b.run('q', 2, 2)
    a.run('q', 3, 3)
    a.send()
    b.send()
    expect(b.rowsOf('q')).toBe(3)
    expect((server.value('run:q') as { table: { rows: unknown[] } }).table.rows.length).toBe(3)
  })

  it('run offline and no one ran it meanwhile — taken when back, the others get it', () => {
    const { a, b } = pair()
    a.run('q', 1, 1)
    a.send()
    b.fetch()
    b.run('q', 2, 7)
    b.bringIntoStep()
    a.fetch()
    expect(a.rowsOf('q')).toBe(7)
    expect(a.n.runs.q.by).toBe('Бета')
  })

  it('a computer\'s clock decides nothing: one far in the future does not win over a later run', () => {
    const { a, b } = pair()
    a.run('q', 9_999_999_999_999, 1)
    a.send()
    b.fetch()
    b.run('q', 5, 2)
    b.send()
    a.fetch()
    expect(a.rowsOf('q')).toBe(2)
  })

  it('a restart (the marks kept with the runs, the fetch from the start): nothing sent again, nothing changed', () => {
    const { server, a, b } = pair()
    a.run('q', 1, 1)
    a.send()
    b.run('p', 2, 2)
    b.send()
    a.fetch()
    const kept: NoteRun = JSON.parse(JSON.stringify(a.n)) as NoteRun
    const again = new Device('dev-a', 'Альфа', server)
    again.n = kept
    const before = server.page(0).seq
    again.bringIntoStep()
    expect(server.page(0).seq).toBe(before)
    expect([again.rowsOf('q'), again.rowsOf('p')]).toEqual([1, 2])
  })

  it('someone\'s result while this device runs it — its run left; its end goes over it', () => {
    const { a, b } = pair()
    b.n.runs.q = { state: 'run', at: 1 }
    a.run('q', 2, 4)
    a.send()
    b.fetch()
    expect(b.n.runs.q.state).toBe('run')
    b.run('q', 3, 9)
    b.send()
    a.fetch()
    expect(a.rowsOf('q')).toBe(9)
  })

  it('a result taken away here — taken away for everyone', () => {
    const { a, b } = pair()
    a.run('q', 1, 1)
    a.send()
    b.fetch()
    delete a.n.runs.q
    a.send()
    b.fetch()
    expect(b.n.runs.q).toBeUndefined()
  })
})
