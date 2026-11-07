import { describe, expect, it } from 'vitest'
import { askShellApproval, cancelShellApproval, setShellApprover } from '../../src/notebook/engine/shellApproval'

const ask = { notePath: 'n.md', block: 'b', lang: 'bash', script: 'ls', why: 'new' as const }

describe('the person\'s say on a shell script', () => {
  it('stopped while asked: no, and the question taken back', async () => {
    let signal: AbortSignal | undefined
    setShellApprover((_a, s) => ((signal = s), new Promise(() => undefined)))
    const answer = askShellApproval(ask, 'slot-1')
    cancelShellApproval('slot-1')
    expect(await answer).toBe('no')
    expect(signal?.aborted).toBe(true)
  })
  it('no answer in time: timeout, the question taken back', async () => {
    let signal: AbortSignal | undefined
    setShellApprover((_a, s) => ((signal = s), new Promise(() => undefined)))
    expect(await askShellApproval(ask, 'slot-2', 10)).toBe('timeout')
    expect(signal?.aborted).toBe(true)
  })
  it('answered: the answer, the question not aborted', async () => {
    let signal: AbortSignal | undefined
    setShellApprover(async (_a, s) => ((signal = s), 'once'))
    expect(await askShellApproval(ask, 'slot-3')).toBe('once')
    expect(signal?.aborted).toBe(false)
  })
  it('no window to ask: no', async () => {
    setShellApprover(undefined)
    expect(await askShellApproval(ask, 'slot-4')).toBe('no')
  })
})
