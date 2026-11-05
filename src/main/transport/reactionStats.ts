import { readJsonFile, writeJsonQuietly } from '../fsAtomic'
import { join } from 'node:path'
import { countedReaction, quickReactions, type ReactionCounts } from '../../shared/transport/reactionStats'

/** How often this person puts each reaction (data/reactions.json): the picker offers the ones put most first. */
export class ReactionStats {
  private readonly file: string
  private counts: ReactionCounts = {}
  constructor(root: string) {
    this.file = join(root, 'reactions.json')
    // (a broken file is set aside — counted anew)
    const v = readJsonFile<unknown>(this.file)
    if (v && typeof v === 'object') this.counts = Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number'))
  }
  quick(): string[] {
    return quickReactions(this.counts)
  }
  /** A reaction put: counted; the reactions offered first now. */
  put(emoji: string): string[] {
    this.counts = countedReaction(this.counts, emoji)
    writeJsonQuietly(this.file, this.counts)
    return this.quick()
  }
}
