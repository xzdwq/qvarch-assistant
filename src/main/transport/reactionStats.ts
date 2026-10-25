import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { countedReaction, quickReactions, type ReactionCounts } from '../../shared/transport/reactionStats'

/** How often this person puts each reaction (data/reactions.json): the picker offers the ones put most first. */
export class ReactionStats {
  private readonly file: string
  private counts: ReactionCounts = {}
  constructor(root: string) {
    this.file = join(root, 'reactions.json')
    try {
      if (existsSync(this.file)) {
        const v: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
        if (v && typeof v === 'object') this.counts = Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number'))
      }
    } catch {
      // a broken file — counted anew
    }
  }
  quick(): string[] {
    return quickReactions(this.counts)
  }
  /** A reaction put: counted; the reactions offered first now. */
  put(emoji: string): string[] {
    this.counts = countedReaction(this.counts, emoji)
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.counts))
    renameSync(`${this.file}.tmp`, this.file)
    return this.quick()
  }
}
