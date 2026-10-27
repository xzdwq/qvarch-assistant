import { reactive } from 'vue'
import { memoryRewrite, NO_DOC_AI, withTurn, type DocAi, type DocMemory, type DocTurn } from '@shared/agent/docAi'
import { doc } from './noteDocs'
import { readonlyPath, sharedDocOfPath, sharedTextOf, sharedTick } from './sharedDocs'

/**
 * The AI's part of a note (shared/agent/docAi) wherever it lives: a shared note's — in its document (everyone of it
 * sees and changes it as the role allows, it comes with the note); a personal one's — in the notebook's marks (it
 * follows a rename). One way in for the panel and for the agents.
 */
const personal = reactive(new Map<string, DocAi>())
const asked = new Set<string>()

/** A note's AI part now (reactive; a personal one read once, then kept here). */
export function docAiNow(path: string): DocAi {
  void sharedTick.n
  if (sharedDocOfPath(path)) return sharedTextOf(path)?.aiNow() ?? NO_DOC_AI
  if (!asked.has(path)) {
    asked.add(path)
    void window.qa.vaultDocAi(path).then(
      (ai) => personal.set(path, ai),
      () => asked.delete(path),
    )
  }
  return personal.get(path) ?? NO_DOC_AI
}

/** The note loaded, and — a shared one — its document in step (an agent may work in a note not open). */
async function ready(path: string): Promise<'shared' | 'personal'> {
  const d = doc(path)
  for (let i = 0; i < 200 && !d.loaded; i++) await new Promise((r) => setTimeout(r, 25))
  if (d.error) throw new Error(`Заметка «${path}»: ${d.error}`)
  if (!sharedDocOfPath(path)) return 'personal'
  for (let i = 0; i < 200 && !sharedTextOf(path); i++) await new Promise((r) => setTimeout(r, 25))
  if (!sharedTextOf(path)) throw new Error('Общая заметка ещё не связана с сервером — попробуйте позже')
  return 'shared'
}
/** A note's AI part, when it is ready (for an agent's turn). */
export async function docAiFor(path: string): Promise<DocAi> {
  if ((await ready(path)) === 'shared') return sharedTextOf(path)!.aiNow()
  const ai = await window.qa.vaultDocAi(path)
  personal.set(path, ai)
  return ai
}
async function changePersonal(path: string, fn: (ai: DocAi) => DocAi): Promise<void> {
  const next = fn(await window.qa.vaultDocAi(path))
  personal.set(path, next)
  await window.qa.vaultSetDocAi(path, JSON.parse(JSON.stringify(next)) as DocAi)
}

/** One may change a note's memory (a reader of a shared note — not). */
export const mayEditDocAi = (path: string): boolean => !readonlyPath(path)

/** The memory changed since the writer saw it: its text now, to write anew with it in mind. */
export class MemoryChanged extends Error {
  constructor(readonly now: DocMemory | undefined) {
    super(`Память документа уже изменили (${now ? `${now.by}` : 'её очистили'}) — перепиши с учётом текущей:\n${now?.text ?? '(пусто)'}`)
  }
}
/**
 * The memory rewritten (by a person, or by an agent — `agent`). `base` — the version the writer saw (its `at`; 0 —
 * none yet): changed since (another person's AI, someone in the panel) — refused with the text now, never overwritten
 * blindly. Its new version.
 */
export async function setDocMemory(path: string, text: string, by: string, agent: boolean, base: number): Promise<DocMemory> {
  if (!mayEditDocAi(path)) throw new Error('Ваша роль в этой заметке — только чтение')
  const shared = (await ready(path)) === 'shared'
  const now = shared ? sharedTextOf(path)!.aiNow().memory : (await window.qa.vaultDocAi(path)).memory
  const memory = memoryRewrite(now, base, text, by, agent, Date.now())
  if (!memory) throw new MemoryChanged(now)
  if (shared) sharedTextOf(path)!.setAiMemory(memory)
  else await changePersonal(path, (ai) => ({ ...ai, memory }))
  return memory
}
/** An agent's turn into the note's journal. */
export async function addDocTurn(path: string, t: DocTurn): Promise<void> {
  if ((await ready(path)) === 'shared') {
    // (a reader's own agent writes nothing into the note)
    if (mayEditDocAi(path)) sharedTextOf(path)!.pushAiTurn(t)
    return
  }
  await changePersonal(path, (ai) => ({ ...ai, turns: withTurn(ai.turns, t) }))
}
