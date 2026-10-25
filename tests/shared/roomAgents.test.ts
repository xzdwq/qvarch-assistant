import { describe, expect, it } from 'vitest'
import { agentFixes } from '../../src/shared/agent/roomAgents'

describe('one’s agents in a chat brought in line with the profiles', () => {
  const profiles = new Map([['me:new', 'ИИ · новое имя']])
  const name = (id: string) => profiles.get(id)
  it('a deleted profile’s agent taken out; another member’s agents never touched', () => {
    const fix = agentFixes(
      [
        { id: 'me:old', name: 'ИИ · старое имя', owner: 'me' },
        { id: 'me:new', name: 'ИИ · новое имя', owner: 'me' },
        { id: 'them:p', name: 'ИИ · коллега', owner: 'them' },
      ],
      'me',
      name,
    )
    expect(fix).toEqual({ remove: ['me:old'], rename: [] })
  })
  it('a renamed profile’s agent renamed; a name the server made unique stays', () => {
    expect(agentFixes([{ id: 'me:new', name: 'ИИ · прежнее', owner: 'me' }], 'me', name).rename).toEqual([{ id: 'me:new', name: 'ИИ · новое имя' }])
    expect(agentFixes([{ id: 'me:new', name: 'ИИ · новое имя 2', owner: 'me' }], 'me', name)).toEqual({ remove: [], rename: [] })
  })
})
