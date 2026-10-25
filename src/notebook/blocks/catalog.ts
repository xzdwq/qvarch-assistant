import type { CommandContext } from '../commands/command'
import { ALL_BLOCK_SPECS } from './specs'

/**
 * The note's components as an AI agent is told of them — from the registry: each kind's name, what it is for, a
 * sample (what its «@» command inserts) and how to set it (its spec's `guide`). A kind with neither a sample nor a
 * guide (a recording, a picture, a chat) is not the agent's to write.
 */
export interface ComponentEntry {
  kind: string
  title: string
  hint: string
  sample?: string
  guide?: string
}
/** What a command is given when its sample is taken (no note, no values yet). */
const SAMPLE_CTX: CommandContext = {
  latin: false,
  notePath: '',
  freeName: (base) => base,
  newestListName: () => 'rows',
  lastValueName: () => 'value',
  firstDbConnection: () => 'db',
  currentSiteUrl: () => 'https://example.com',
  now: () => new Date(),
  newId: () => 'id1',
}

export function componentCatalog(): ComponentEntry[] {
  return ALL_BLOCK_SPECS.flatMap((spec) => {
    const cmd = spec.commands?.[0]
    const effect = cmd?.run(SAMPLE_CTX)
    const sample = effect?.kind === 'insertBlock' ? effect.markdown : undefined
    if (!sample && !spec.guide) return []
    return [{ kind: spec.kind, title: spec.title, hint: cmd?.hint ?? '', ...(sample ? { sample } : {}), ...(spec.guide ? { guide: spec.guide } : {}) }]
  })
}
/** The components in a line each (the agent's prompt). */
export const componentsBrief = (): string =>
  componentCatalog()
    .map((c) => `- ${c.title} (${c.kind})${c.hint ? ` — ${c.hint}` : ''}`)
    .join('\n')
/** A component written out (one kind, or all): what it is for, how to set it, its sample. */
export function componentsGuide(kind?: string): string {
  const list = componentCatalog().filter((c) => !kind || c.kind === kind.trim().toLowerCase())
  if (!list.length) return `Компонента «${kind}» нет. Есть: ${componentCatalog().map((c) => c.kind).join(', ')}`
  return list.map((c) => [`## ${c.title} (${c.kind})`, c.hint, c.guide, c.sample ? `Образец:\n${c.sample}` : ''].filter(Boolean).join('\n')).join('\n\n')
}
