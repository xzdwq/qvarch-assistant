import { summary } from '@nb/domain/values'
import { noteReport, noteRun, noteRunsSettled, runAll, runItemNamed, runItemWhereItStands, runWaitsIn, syncNoteData } from '@nb/engine'
import type { RunTrigger } from '@shared/cronJobs'
import { docLinkPath, shareLinkOf } from '@nb/workspace/docLinks'
import { docs, files, loadTree, openFile, save, setText } from './notebook'
import { MemoryChanged, setDocMemory } from '@nb/workspace/docAiStore'
import { agentByOf, agentWrote, agentWroteMemory } from './agentWrites'
import { isHeld, postMessage, roomOf } from './chat'
import { itemReport, noteRunsLoaded as runsLoaded, noteTextOf as textOf } from './noteRunAccess'
import { serveOps } from './serveOps'
import { doneOrWaiting, waitWords } from './runWaitWords'

/**
 * The AI assistants' tools (MCP, served by the main process) work on the notes here — where the editor holds
 * them: the text as typed, the runs and their results shown as they go, saved as usual.
 */
/** How long the results asked for wait for a run of the note going on. */
const RESULTS_WAIT_MS = 5 * 60_000

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
    // (who ran it — the agent by its name — goes into the note's journal)
    const trigger: RunTrigger = { by: 'ai', at: Date.now(), who: agentByOf(a)?.name }
    if (!want) {
      // a block waiting for a person (a terminal's password) answers at once — never waited out
      const r = await doneOrWaiting(path, runAll(path, text, trigger))
      if ('wait' in r) return waitWords(text, r.wait)
      const n = noteRun(path)
      const stop = n.all?.error ? `\n\n⛔ Прогон остановился на «${n.all.at}»: ${n.all.error}` : ''
      return `${noteReport(path, text)}${stop}\n\n${vars(path)}`.trim()
    }
    // any runnable block (HTTP, code, Playwright, SQL, a template) or a loop — by its name or key, where it stands
    const item = runItemNamed(text, want)
    if (!item) throw new Error(`В заметке нет исполняемого блока или цикла «${want}» (name=…)`)
    // (a loop: any of its blocks may ask; a block — itself)
    const r = await doneOrWaiting(path, runItemWhereItStands(path, text, item, trigger), item.kind === 'loop' ? undefined : new Set([item.key]))
    if ('wait' in r) return waitWords(text, r.wait)
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
  /** The note's latest results — a run of it going on here waited for first (up to RESULTS_WAIT_MS). */
  async report(a) {
    const path = String(a.path)
    await runsLoaded(path)
    const t0 = Date.now()
    // a run waiting for a person is not waited for: said at once (it goes on once they answer)
    const r = await doneOrWaiting(path, noteRunsSettled(path, RESULTS_WAIT_MS))
    const waited = Date.now() - t0
    const waits = runWaitsIn(path)
    const head =
      'wait' in r || waits.length
        ? waitWords(await textOf(path), 'wait' in r ? r.wait : waits[0])
        : !r.done
          ? `Прогон ещё идёт (${Math.round(waited / 60_000)} мин) — результаты на сейчас; итог вернёт note_run, который его запустил`
          : waited > 1000
            ? `Дождался конца прогона (${Math.round(waited / 1000)} с)`
            : ''
    // (the text read after the wait: a run may have given a block its id)
    const text = await textOf(path)
    return [head, noteReport(path, text), vars(path)].filter(Boolean).join('\n\n').trim()
  },
}

let on = false
export function startMcpBridge(): void {
  if (on) return
  on = true
  window.qa.onMcpCall(serveOps(OPS, (id, ok, v) => window.qa.mcpReply(id, ok, v)))
}
