import { reactive } from 'vue'
import { agentLineMarks, agentLinesAfter, type AgentLines } from '@shared/notebook/agentLines'
import type { LineAuthor } from '@shared/transport/sharedText'
import { doc } from './noteDocs'
import { agentWrote, sharedDocOfPath, sharedTick } from './sharedDocs'
import { sharedLineAuthors } from './sharedPlaces'

/**
 * Who wrote each line of a note: a shared note — by its edits' marks (a person, or their AI agent); a personal one —
 * the lines its owner's agents wrote, by their text (agentLines; a line changed since is the owner's own again).
 */
const kept = reactive(new Map<string, AgentLines>())
const loading = new Set<string>()

/** A personal note's agents' lines (read once; asked before they are in — none for now). */
function keptOf(path: string): AgentLines {
  const k = kept.get(path)
  if (k || loading.has(path)) return k ?? {}
  loading.add(path)
  void window.qa
    .vaultAgentLines(path)
    .then((v) => kept.set(path, v))
    .catch(() => kept.set(path, {}))
    .finally(() => loading.delete(path))
  return {}
}

/** Each line's author (0-based line); none known — an empty map. */
export function lineAuthorsOf(path: string): Map<number, LineAuthor> {
  void sharedTick.n
  const shared = sharedLineAuthors(path)
  if (shared) return shared
  const d = doc(path)
  if (!d.loaded) return new Map()
  return new Map([...agentLineMarks(d.text, keptOf(path))].map(([line, agent]) => [line, { agent }]))
}

/** An AI agent wrote a note (its text before and after): the lines it put in are marked as its. */
export async function markAgentWrite(path: string, before: string, after: string, agent: string): Promise<void> {
  if (sharedDocOfPath(path)) return agentWrote(path, after, agent)
  const was = kept.get(path) ?? (await window.qa.vaultAgentLines(path).catch((): AgentLines => ({})))
  const next = agentLinesAfter(was, before, after, agent)
  kept.set(path, next)
  await window.qa.vaultSetAgentLines(path, next)
}
