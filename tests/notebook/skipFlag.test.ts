import { describe, expect, it } from 'vitest'
import type { QaApi } from '../../src/shared/api'
import { infoMd, parseInfo } from '../../src/notebook/domain/blockInfo'
import { findLoops, loopOpenMd, parseLoopInfo } from '../../src/notebook/domain/loop'
import { itemIsSkipped, itemName, runItemsIn } from '../../src/notebook/engine/runItems'
import { runItemNamed } from '../../src/notebook/engine/runNote'
import { noteReport } from '../../src/notebook/engine/reports'
import { setRunApi } from '../../src/notebook/engine/runApi'

const fence = (info: string, body = '1') => '```' + info + '\n' + body + '\n```\n'

describe('a block left out of the batch runs (skip)', () => {
  it('skip is read and written back', () => {
    expect(parseInfo('powershell run skip name=x').skip).toBe(true)
    expect(parseInfo('js run name=x').skip).toBeUndefined()
    expect(infoMd(parseInfo('js run skip'))).toBe('js run skip')
  })
  it('a loop marked skip', () => {
    expect(parseLoopInfo('name=l skip').skip).toBe(true)
    expect(loopOpenMd({ ...parseLoopInfo('name=l'), skip: true })).toContain(' skip')
  })
  it('the batch list leaves skipped blocks out; with them asked — they are there', () => {
    const text = fence('js run name=a') + fence('js run skip name=b')
    expect(runItemsIn(text).map(itemName)).toEqual(['a'])
    const all = runItemsIn(text, undefined, { withSkipped: true })
    expect(all.map(itemName)).toEqual(['a', 'b'])
    expect(all.map(itemIsSkipped)).toEqual([false, true])
  })
  it('a skipped loop is left out of the batch; a skipped block inside a loop — out of its passes', () => {
    const text = ['<!-- qa:loop name=l1 skip -->', fence('js loop', 'for (const x of [1]) await body({ x })'), fence('js run name=a'), '<!-- /qa:loop -->', '<!-- qa:loop name=l2 -->', fence('js loop', 'await body({})'), fence('js run name=b'), fence('js run skip name=c'), '<!-- /qa:loop -->'].join('\n')
    expect(runItemsIn(text).map(itemName)).toEqual(['l2'])
    const l2 = findLoops(text.split('\n')).find((l) => l.info.name === 'l2')!
    expect(runItemsIn(text, l2).map(itemName)).toEqual(['b'])
  })
  it('by name a skipped block is still found (run by hand, by the AI)', () => {
    const text = fence('js run name=a') + fence('js run skip name=b')
    expect(runItemNamed(text, 'b')).toBeDefined()
  })
  it('the note\'s report says the skipped block is out of the batch', () => {
    setRunApi({ runLoad: async () => undefined, runSave: async () => undefined } as unknown as QaApi)
    const r = noteReport('skip-report.md', fence('js run name=a') + fence('js run skip name=b'))
    expect(r).toContain('«b» — пропущен (не участвует в «Выполнить всё»)')
  })
})
