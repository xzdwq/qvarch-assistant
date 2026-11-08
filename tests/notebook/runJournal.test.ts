import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { docRunOf, docRunsOf, DOC_RUNS_MAX, runWhoOf, withRun, type DocRun } from '../../src/shared/agent/docRuns'
import { docAiOf } from '../../src/shared/agent/docAi'
import { PromptWatch } from '../../src/shared/shell/promptWatch'
import * as engine from '../../src/notebook/engine'
import { setRunApi } from '../../src/notebook/engine/runApi'
import { takeRunWaited } from '../../src/notebook/engine/runWaits'

describe('who ran it', () => {
  it('a person by hand (by name), an AI agent, a harness check, a schedule', () => {
    expect(runWhoOf({ by: 'hand', at: 1 }, 'Виктор')).toEqual({ kind: 'person', name: 'Виктор' })
    expect(runWhoOf(undefined, 'Вы')).toEqual({ kind: 'person', name: 'Вы' })
    expect(runWhoOf({ by: 'ai', at: 1, who: 'Claude' }, 'Вы')).toEqual({ kind: 'ai', name: 'Claude' })
    expect(runWhoOf({ by: 'ai', at: 1 }, 'Вы')).toEqual({ kind: 'ai', name: 'ИИ' })
    expect(runWhoOf({ by: 'ai', at: 1, harness: true }, 'Вы')).toEqual({ kind: 'harness', name: 'проверка harness' })
    expect(runWhoOf({ by: 'cron', at: 1, cron: { id: 'c', title: 'Ночной', expr: '0 3 * * *' } }, 'Вы')).toEqual({ kind: 'cron', name: 'Ночной' })
  })
  it('a run kept: its error only when it failed; the journal keeps the latest; malformed ones dropped on read', () => {
    const ok = docRunOf({ at: 5, ms: 12.6, who: { kind: 'person', name: 'Вы' }, block: 'Оболочка «logs»', line: 37, ok: true, error: 'нет' })
    expect(ok).toMatchObject({ at: 5, ms: 13, block: 'Оболочка «logs»', line: 37, outcome: 'ok' })
    expect(ok.error).toBeUndefined()
    const bad = docRunOf({ at: 6, ms: 1, who: { kind: 'ai', name: 'Claude' }, block: 'x', line: 1, ok: false, error: 'e'.repeat(500), waited: true, all: true })
    expect(bad).toMatchObject({ outcome: 'error', waited: true, all: true })
    expect(bad.error).toHaveLength(300)
    let runs: DocRun[] = []
    for (let i = 0; i < DOC_RUNS_MAX + 5; i++) runs = withRun(runs, { ...ok, id: String(i) })
    expect(runs).toHaveLength(DOC_RUNS_MAX)
    expect(runs[0].id).toBe('5')
    expect(docRunsOf([ok, { id: 'x' }, null])).toEqual([ok])
    expect(docAiOf({ turns: [], runs: [ok, 'junk'] }).runs).toEqual([ok])
    expect(docAiOf({ turns: [] }).runs).toBeUndefined()
  })
})

describe('a terminal that asks and waits', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('an unended line, then quiet — it asks (once); more output / an answer / the end — it goes on', () => {
    const told: Array<string | undefined> = []
    const w = new PromptWatch((p) => told.push(p), 1000)
    w.feed('line one\n[sudo] password for me: ')
    vi.advanceTimersByTime(999)
    expect(told).toEqual([])
    vi.advanceTimersByTime(1)
    expect(told).toEqual(['[sudo] password for me:'])
    w.answered()
    expect(told).toEqual(['[sudo] password for me:', undefined])
    w.feed('\nok\n')
    vi.advanceTimersByTime(5000)
    // (ended lines only: nothing asked)
    expect(told).toHaveLength(2)
    w.feed('Continue? [y/N] ')
    vi.advanceTimersByTime(1000)
    w.end()
    expect(told).toEqual(['[sudo] password for me:', undefined, 'Continue? [y/N]', undefined])
  })
  it('output that keeps coming is never taken as asking', () => {
    const told: Array<string | undefined> = []
    const w = new PromptWatch((p) => told.push(p), 1000)
    for (let i = 0; i < 10; i++) {
      w.feed(`progress ${i}%`)
      vi.advanceTimersByTime(500)
    }
    expect(told).toEqual([])
  })
})

describe('the runs waiting for a person', () => {
  it('a wait now or later, of the blocks asked for only; marked as waited once', async () => {
    engine.setRunWaiting('n.md', 'a', 'pw:')
    const now = engine.whenRunWaits('n.md')
    await expect(now.wait).resolves.toMatchObject({ key: 'a', prompt: 'pw:' })
    engine.setRunWaiting('n.md', 'a', undefined)
    expect(engine.runWaitOf('n.md', 'a')).toBeUndefined()
    const onlyB = engine.whenRunWaits('n.md', new Set(['b']))
    let got: string | undefined
    void onlyB.wait.then((w) => (got = w.key))
    engine.setRunWaiting('n.md', 'a', 'again:')
    await Promise.resolve()
    expect(got).toBeUndefined()
    engine.setRunWaiting('n.md', 'b', 'yes?')
    await Promise.resolve()
    expect(got).toBe('b')
    expect(engine.runWaitsIn('n.md').map((w) => w.key).sort()).toEqual(['a', 'b'])
    expect(takeRunWaited('n.md', 'a')).toBe(true)
    expect(takeRunWaited('n.md', 'a')).toBe(false)
  })
})

describe('the journal of runs', () => {
  const recorded: Array<{ path: string; run: DocRun }> = []
  beforeEach(() => {
    recorded.length = 0
    setRunApi({
      runLoad: async () => undefined,
      runSave: async () => undefined,
      runCode: async () => ({ ok: false, error: 'boom', logs: [], ms: 1 }),
      runCodeStop: () => undefined,
      onRunEmit: () => () => undefined,
    } as unknown as Parameters<typeof setRunApi>[0])
    engine.setRunJournalHost({ person: () => 'Виктор', record: (path, run) => recorded.push({ path, run }) })
  })
  afterEach(() => engine.setRunJournalHost(undefined))
  it('a block run by hand and by the AI: who, which block, how it ended', async () => {
    const text = '# T\n\n```ts run name=total\nreturn 1\n```\n'
    const block = { kind: 'code' as const, info: { lang: 'ts', run: true, lib: false, name: 'total' }, body: 'return 1', line: 3 }
    await engine.runBlockAt('j/a.md', text, block)
    const item = engine.runItemNamed(text, 'total')!
    await engine.runItemWhereItStands('j/a.md', text, item, { by: 'ai', at: Date.now(), who: 'Claude' })
    expect(recorded.map((r) => [r.path, r.run.who, r.run.block, r.run.line, r.run.outcome])).toEqual([
      ['j/a.md', { kind: 'person', name: 'Виктор' }, 'Код «total»', 3, 'error'],
      ['j/a.md', { kind: 'ai', name: 'Claude' }, 'Код «total»', 3, 'error'],
    ])
    expect(recorded[0].run.error).toMatch(/boom/)
  })
  it('«Выполнить всё»: each block marked as part of it, by the AI that asked', async () => {
    const text = '```ts run name=a\nreturn 1\n```\n\n```ts run name=b soft\nreturn 2\n```\n'
    await engine.runAll('j/b.md', text, { by: 'ai', at: Date.now(), who: 'Claude' })
    expect(recorded.map((r) => [r.run.block, r.run.all, r.run.who.name])).toEqual([['Код «a»', true, 'Claude']])
  })
})
