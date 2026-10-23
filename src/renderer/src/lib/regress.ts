import { reactive } from 'vue'
import type { BlockInfo } from '@nb/domain/blockInfo'
import { fencedBlocksOf } from '@nb/domain/noteBlocks'
import { noteRun, runBlockInNote, saveRunsSoon, stopBlockInNote } from '@nb/engine'
import { REGRESS_KEEP, swapStand, tallyChecks, type RegressCfg, type RegressItem, type RegressRun } from '@shared/regress'
import type { VaultNode } from '@shared/vault'

/**
 * «Регрессия» running: the Playwright tests of a folder one after another (each one's result also goes to its own
 * note, as if run there), on the stand chosen; the run kept with the block (its history, by date).
 */
interface Test {
  note: string
  key: string
  name: string
  info: BlockInfo
  code: string
  text: string
  /** Its first line in its note. */
  line: number
}
const live = reactive(new Map<string, { done: number; total: number; current?: string; stop?: boolean; cur?: Test }>())
export const regressLive = (path: string, key: string) => live.get(`${path}#${key}`)

const notesIn = (tree: VaultNode[], cfg: RegressCfg) => {
  const walk = (ns: VaultNode[]): VaultNode[] => ns.flatMap((n) => (n.dir ? walk(n.children ?? []) : [n]))
  const base = cfg.folder.replace(/\/+$/, '')
  return walk(tree)
    .filter((n) => /\.md$/i.test(n.path))
    .filter((n) => !base || n.path.startsWith(`${base}/`))
    .filter((n) => cfg.deep || !n.path.slice(base ? base.length + 1 : 0).includes('/'))
    .sort((a, b) => a.path.localeCompare(b.path, 'ru'))
}
/** The tests of a folder: every Playwright block of its notes. */
export async function testsOf(cfg: RegressCfg): Promise<Test[]> {
  const out: Test[] = []
  for (const n of notesIn(await window.qa.vaultTree(), cfg)) {
    const text = await window.qa.vaultRead(n.path).catch(() => '')
    for (const b of fencedBlocksOf(text)) {
      if (b.kind !== 'pw') continue
      // a name a person reads: the block's own, else its first step's words
      const step = /\/\/ шаг: (.+)$/m.exec(b.body.split('\n').find((l) => /\/\/ шаг: (?!-|Окно браузера)/.test(l)) ?? '')?.[1]
      out.push({ note: n.path, key: b.key, name: b.info.name ?? step ?? 'Сценарий', info: b.info, code: b.body, text, line: b.line0 })
    }
  }
  return out
}
export const historyOf = (path: string, key: string): RegressRun[] => ((noteRun(path).runs[key]?.value as { history?: RegressRun[] } | undefined)?.history ?? [])

export async function runRegression(path: string, key: string, cfg: RegressCfg): Promise<void> {
  const id = `${path}#${key}`
  if (live.has(id)) return
  const n = noteRun(path)
  // the history saved before must be in first (it is read from the disk a moment after the note opens)
  for (let i = 0; i < 40 && !n.loaded; i++) await new Promise((r) => setTimeout(r, 50))
  const tests = await testsOf(cfg)
  const st = reactive({ done: 0, total: tests.length } as { done: number; total: number; current?: string; stop?: boolean; cur?: Test })
  live.set(id, st)
  const before = historyOf(path, key)
  n.runs[key] = { state: 'run', at: Date.now(), value: { history: before }, hasValue: false }
  const t0 = Date.now()
  const items: RegressItem[] = []
  try {
    for (const t of tests) {
      if (st.stop) break
      st.current = `${t.note.split('/').pop()!.replace(/\.md$/i, '')} · ${t.name}`
      st.cur = t
      const s0 = Date.now()
      const ok = await runBlockInNote(t.note, t.text, { kind: 'pw', info: t.info, body: swapStand(t.code, cfg.from, cfg.to), line: t.line })
      if (st.stop && !ok) break
      const r = noteRun(t.note).runs[t.key]
      const ch = r?.checks ?? []
      items.push({
        note: t.note,
        key: t.key,
        name: t.name,
        state: ok ? 'ok' : 'fail',
        ms: Date.now() - s0,
        ...(ok ? {} : { error: (r?.error ?? 'ошибка').split('\n')[0].slice(0, 300) }),
        ...(ch.length ? { checks: tallyChecks(ch) } : {}),
        ...(t.info.soft ? { soft: true } : {}),
      })
      st.done++
    }
  } finally {
    const run: RegressRun = { at: t0, ms: Date.now() - t0, ...(cfg.from && cfg.to ? { stand: cfg.to } : {}), items, ...(st.stop ? { stopped: true } : {}) }
    const history = [...before, run].slice(-REGRESS_KEEP)
    const failed = items.some((i) => i.state === 'fail' && !i.soft)
    n.runs[key] = { state: failed ? 'error' : 'ok', at: Date.now(), ms: run.ms, value: { history }, hasValue: false }
    saveRunsSoon(path)
    live.delete(id)
  }
}
/** The regression stopped: no next test, the current one stopped. */
export function stopRegression(path: string, key: string): void {
  const x = live.get(`${path}#${key}`)
  if (!x) return
  x.stop = true
  if (x.cur) stopBlockInNote(x.cur.note, { kind: 'pw', info: x.cur.info, line: x.cur.line })
}
