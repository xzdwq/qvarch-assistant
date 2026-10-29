import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOARD_EXT } from '../../shared/whiteboard'
import { isEmoji } from '../../shared/emoji'
import type { AgentLines } from '../../shared/notebook/agentLines'
import { docAiOf, type DocAi } from '../../shared/agent/docAi'
import type { VaultFiles } from './vaultFiles'

interface MetaData {
  colors: Record<string, string>
  pairs: Record<string, string>
  emojis: Record<string, string>
  /** The lines AI agents wrote in each personal note (shared/notebook/agentLines). */
  agentLines: Record<string, AgentLines>
  /** The AI's memory and journal of each personal note (shared/agent/docAi; a shared note keeps its own in its document). */
  docAi: Record<string, DocAi>
}

/**
 * The user's marks of notes / folders, in vault/.meta.json: a colour, an emoji, a note ↔ board link. They follow
 * a rename / move; a deleted thing loses them.
 */
export class VaultMeta {
  private data: MetaData

  constructor(private files: VaultFiles) {
    try {
      this.data = { colors: {}, pairs: {}, emojis: {}, agentLines: {}, docAi: {}, ...JSON.parse(readFileSync(this.file, 'utf8')) }
    } catch {
      this.data = { colors: {}, pairs: {}, emojis: {}, agentLines: {}, docAi: {} }
    }
  }
  private get file(): string {
    return join(this.files.root, '.meta.json')
  }
  /** Written whole (a temp file + rename: never half a file). */
  save(): void {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data, null, 1), 'utf8')
    renameSync(`${this.file}.tmp`, this.file)
  }

  colorOf = (rel: string): string | undefined => this.data.colors[rel]
  emojiOf = (rel: string): string | undefined => this.data.emojis[rel]
  pairOf = (rel: string): string | undefined => this.data.pairs[rel]
  agentLinesOf = (rel: string): AgentLines => this.data.agentLines[rel] ?? {}

  docAiOf = (rel: string): DocAi => docAiOf(this.data.docAi[rel])
  /** A note's AI memory and journal (empty — none kept). */
  setDocAi(rel: string, ai: DocAi): void {
    this.files.abs(rel)
    const clean = docAiOf(ai)
    if (clean.memory || clean.turns.length) this.data.docAi[rel] = clean
    else delete this.data.docAi[rel]
    this.save()
  }

  /** The lines agents wrote in a note (empty — none kept). */
  setAgentLines(rel: string, lines: AgentLines): void {
    this.files.abs(rel)
    if (Object.keys(lines).length) this.data.agentLines[rel] = lines
    else delete this.data.agentLines[rel]
    this.save()
  }

  /** A colour mark (undefined — none). */
  setColor(rel: string, color?: string): void {
    this.files.abs(rel)
    if (color) this.data.colors[rel] = color
    else delete this.data.colors[rel]
    this.save()
  }
  /** An emoji mark (undefined — none); it can stand together with the colour. */
  setEmoji(rel: string, emoji?: string): void {
    this.files.abs(rel)
    if (emoji) this.data.emojis[rel] = emoji
    else delete this.data.emojis[rel]
    this.save()
  }
  /**
   * A note and a board linked (one view of the other): a .md with a .qboard, each with one partner; b undefined —
   * unlinked. Both directions are kept.
   */
  setPair(a: string, b?: string): void {
    const unlink = (p: string) => {
      const o = this.data.pairs[p]
      if (o) delete this.data.pairs[o]
      delete this.data.pairs[p]
    }
    unlink(a)
    if (b) {
      const kinds = [a, b].map((p) => (p.toLowerCase().endsWith(BOARD_EXT) ? 'b' : p.toLowerCase().endsWith('.md') ? 'n' : '?')).sort().join('')
      if (kinds !== 'bn') throw new Error('Связать можно заметку с доской')
      if (!existsSync(this.files.abs(a)) || !existsSync(this.files.abs(b))) throw new Error('Файл не найден')
      unlink(b)
      this.data.pairs[a] = b
      this.data.pairs[b] = a
    }
    this.save()
  }

  /** Marks set without saving (an import sets many, then saves once). */
  markUnsaved(rel: string, marks: { color?: unknown; emoji?: unknown }): void {
    if (typeof marks.color === 'string' && /^#[0-9a-f]{6}$/i.test(marks.color)) this.data.colors[rel] = marks.color
    if (isEmoji(marks.emoji)) this.data.emojis[rel] = marks.emoji
  }
  /** A link set without saving (both directions). */
  linkUnsaved(a: string, b: string): void {
    this.data.pairs[a] = b
    this.data.pairs[b] = a
  }

  /** Marks and links follow a rename / move (`to` undefined — deleted: they go). */
  remap(from: string, to?: string): void {
    let changed = false
    const pairs: Record<string, string> = {}
    for (const [k, v] of Object.entries(this.data.pairs)) {
      const nk = k === from || k.startsWith(from + '/') ? (to === undefined ? undefined : to + k.slice(from.length)) : k
      const nv = v === from || v.startsWith(from + '/') ? (to === undefined ? undefined : to + v.slice(from.length)) : v
      if (nk !== k || nv !== v) changed = true
      if (nk && nv) pairs[nk] = nv
    }
    this.data.pairs = pairs
    for (const map of [this.data.colors, this.data.emojis, this.data.agentLines, this.data.docAi] as Array<Record<string, unknown>>)
      for (const k of Object.keys(map)) {
        if (k !== from && !k.startsWith(from + '/')) continue
        const v = map[k]
        delete map[k]
        if (to !== undefined) map[to + k.slice(from.length)] = v
        changed = true
      }
    if (changed) this.save()
  }
}
