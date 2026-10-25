import { describe, expect, it } from 'vitest'
import { REACTIONS } from '../../src/shared/transport/chat'
import { countedReaction, quickReactions } from '../../src/shared/transport/reactionStats'

describe('the reactions offered first', () => {
  it('none put yet — the usual ones', () => {
    expect(quickReactions({})).toEqual([...REACTIONS])
  })
  it('the ones put most first, the usual ones filling the row; a non-emoji never', () => {
    let c = {}
    for (const e of ['🔥', '🔥', '👀', '🔥', 'текст']) c = countedReaction(c, e)
    const q = quickReactions(c)
    expect(q.slice(0, 2)).toEqual(['🔥', '👀'])
    expect(q).toHaveLength(REACTIONS.length)
    expect(q).not.toContain('текст')
  })
  it('the counts stay small: the rarest dropped', () => {
    let c = {}
    for (let i = 0; i < 5; i++) c = countedReaction(c, '👍')
    c = countedReaction(c, '😮', 1)
    expect(c).toEqual({ '👍': 5 })
  })
})
