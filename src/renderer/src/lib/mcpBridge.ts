import { summary } from '@nb/domain/values'
import { blockReport, loopReport, noteReport, noteRun, runAll, runItemNamed, runItemWhereItStands, syncDataBlocks, type RunItem } from '@nb/engine'
import { doc, docs, loadTree, openFile, save, setText } from './notebook'

/**
 * The AI assistants' tools (MCP, served by the main process) work on the notes here — where the editor holds
 * them: the text as typed, the runs and their results shown as they go, saved as usual.
 */
async function textOf(path: string): Promise<string> {
  const d = doc(path)
  for (let i = 0; i < 200 && !d.loaded; i++) await new Promise((r) => setTimeout(r, 25))
  if (d.error) throw new Error(`Заметка «${path}»: ${d.error}`)
  return d.text
}
async function runsLoaded(path: string): Promise<void> {
  const n = noteRun(path)
  for (let i = 0; i < 200 && !n.loaded; i++) await new Promise((r) => setTimeout(r, 25))
}
function vars(path: string): string {
  const ctx = noteRun(path).ctx
  const keys = Object.keys(ctx)
  return keys.length ? `Переменные: ${keys.map((k) => `${k} = ${summary(ctx[k].value)}`).join('; ')}` : ''
}

/** An item's last run as a report (a loop — its passes; in a loop's pass, its block — the pass shown). */
function itemReport(path: string, item: RunItem): string {
  switch (item.kind) {
    case 'loop':
      return loopReport(noteRun(path).loops[item.key], item.loop.info.name ?? item.key)
    default:
      return blockReport(path, item.key, item.kind, item.info, item.body)
  }
}

const OPS: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {
  async refresh() {
    await loadTree()
    return true
  },
  async read(a) {
    return textOf(String(a.path))
  },
  async write(a) {
    const path = String(a.path)
    const text = String(a.text)
    if (docs.has(path)) {
      await textOf(path)
      setText(path, text)
      await save(path)
    } else await window.qa.vaultWrite(path, text)
    await loadTree()
    openFile(path)
    return path
  },
  async create(a) {
    const path = await window.qa.vaultCreate(String(a.dir ?? ''), 'note', String(a.name), String(a.text ?? ''))
    await loadTree()
    openFile(path)
    return path
  },
  async run(a) {
    const path = String(a.path)
    const text = await textOf(path)
    await runsLoaded(path)
    openFile(path)
    syncDataBlocks(path, text)
    const want = typeof a.block === 'string' && a.block ? a.block : undefined
    if (!want) {
      await runAll(path, text)
      const n = noteRun(path)
      const stop = n.all?.error ? `\n\n⛔ Прогон остановился на «${n.all.at}»: ${n.all.error}` : ''
      return `${noteReport(path, text)}${stop}\n\n${vars(path)}`.trim()
    }
    // any runnable block (HTTP, code, Playwright, SQL, a template) or a loop — by its name or key, where it stands
    const item = runItemNamed(text, want)
    if (!item) throw new Error(`В заметке нет исполняемого блока или цикла «${want}» (name=…)`)
    await runItemWhereItStands(path, text, item)
    return `${itemReport(path, item)}\n\n${vars(path)}`.trim()
  },
  async report(a) {
    const path = String(a.path)
    const text = await textOf(path)
    await runsLoaded(path)
    return `${noteReport(path, text)}\n\n${vars(path)}`.trim()
  },
}

let on = false
export function startMcpBridge(): void {
  if (on) return
  on = true
  window.qa.onMcpCall((id, op, args) => {
    const fn = OPS[op]
    if (!fn) return window.qa.mcpReply(id, false, `Неизвестная операция ${op}`)
    fn(args ?? {}).then(
      (v) => window.qa.mcpReply(id, true, v),
      (e: unknown) => window.qa.mcpReply(id, false, e instanceof Error ? e.message : String(e)),
    )
  })
}
