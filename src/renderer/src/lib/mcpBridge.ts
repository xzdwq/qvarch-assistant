import { summary } from '@nb/domain/values'
import { noteReport, noteRun, runAll, runItemNamed, runItemWhereItStands, syncNoteData } from '@nb/engine'
import { docLinkPath, shareLinkOf } from '@nb/workspace/docLinks'
import { docs, files, loadTree, openFile, save, setText } from './notebook'
import { MemoryChanged, setDocMemory } from '@nb/workspace/docAiStore'
import { agentByOf, agentWrote, agentWroteMemory } from './agentWrites'
import { isHeld, postMessage, roomOf } from './chat'
import { itemReport, noteRunsLoaded as runsLoaded, noteTextOf as textOf } from './noteRunAccess'
import type { RunTrigger } from '@shared/cronJobs'

/**
 * The AI assistants' tools (MCP, served by the main process) work on the notes here — where the editor holds
 * them: the text as typed, the runs and their results shown as they go, saved as usual.
 */
function vars(path: string): string {
  const ctx = noteRun(path).ctx
  const keys = Object.keys(ctx)
  return keys.length ? `Переменные: ${keys.map((k) => `${k} = ${summary(ctx[k].value)}`).join('; ')}` : ''
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
    const by = agentByOf(a)
    // (an agent's write goes through the note as typed: a shared one gets its lines marked as the agent's)
    if (docs.has(path) || (by && files.value.includes(path))) {
      const before = await textOf(path)
      setText(path, text)
      if (by) await agentWrote(by, path, before, text)
      await save(path)
    } else await window.qa.vaultWrite(path, text)
    await loadTree()
    // (an agent writing in the background never switches the note one is in)
    if (a.quiet !== true) openFile(path)
    return path
  },
  async create(a) {
    const text = String(a.text ?? '')
    const path = await window.qa.vaultCreate(String(a.dir ?? ''), 'note', String(a.name), text)
    const by = agentByOf(a)
    if (by) await agentWrote(by, path, '', text)
    await loadTree()
    if (a.quiet !== true) openFile(path)
    return path
  },
  async run(a) {
    const path = String(a.path)
    const text = await textOf(path)
    await runsLoaded(path)
    openFile(path)
    syncNoteData(path, text)
    const want = typeof a.block === 'string' && a.block ? a.block : undefined
    if (!want) {
      await runAll(path, text, { by: 'ai', at: Date.now() })
      const n = noteRun(path)
      const stop = n.all?.error ? `\n\n⛔ Прогон остановился на «${n.all.at}»: ${n.all.error}` : ''
      return `${noteReport(path, text)}${stop}\n\n${vars(path)}`.trim()
    }
    // any runnable block (HTTP, code, Playwright, SQL, a template) or a loop — by its name or key, where it stands
    const item = runItemNamed(text, want)
    if (!item) throw new Error(`В заметке нет исполняемого блока или цикла «${want}» (name=…)`)
    await runItemWhereItStands(path, text, item, { by: 'ai', at: Date.now() })
    return `${itemReport(path, item)}\n\n${vars(path)}`.trim()
  },
  /**
   * A scheduled run: «Выполнить всё» in the background (the note not opened; its `trigger` — the schedule); where
   * it stopped, if it did.
   */
  async cron(a) {
    const path = String(a.path)
    if (!files.value.includes(path)) throw new Error(`Заметки «${path}» нет`)
    const text = await textOf(path)
    await runsLoaded(path)
    await runAll(path, text, a.trigger as RunTrigger)
    const all = noteRun(path).all
    return all?.error ? { error: `«${all.at}»: ${all.error}` } : {}
  },
  /** An agent rewrites a document's memory (docAi). */
  async memory(a) {
    const by = agentByOf(a)
    if (!by) throw new Error('Память документа меняет только ИИ в своём ходе')
    try {
      const m = await setDocMemory(String(a.path), String(a.text), by.name, true, Number(a.base) || 0)
      agentWroteMemory(by)
      return { at: m.at }
    } catch (e) {
      // (changed meanwhile: the memory now and its version — the agent writes anew over it)
      if (e instanceof MemoryChanged) return { changed: e.message, at: e.now?.at ?? 0 }
      throw e
    }
  },
  /** An agent opens a shared note's link (joined by its code when not here). */
  async docLink(a) {
    return docLinkPath(String(a.url), true)
  },
  /** An agent gives a note to a chat: its link (the note shared when it is not). */
  async shareLink(a) {
    return shareLinkOf(String(a.path))
  },
  /** An agent sends a note into a chat as a file (a copy), as its own message. */
  async forward(a) {
    const room = String(a.room)
    if (isHeld(room)) throw new Error('Файлы отправляются через сервер, а этот чат пока только на этом компьютере — дай ссылку [[…]]')
    const file = await window.qa.chatFileFromNotes(room, String(a.path), false)
    const agent = roomOf(room)?.agents?.find((x) => x.id === String(a.agent))
    if (!agent) throw new Error('Этого ИИ нет в чате')
    await postMessage(room, { text: String(a.text ?? ''), agent: { id: agent.id, name: agent.name }, attach: { kind: 'file', title: file.name, data: file } })
    return file.name
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
