import { describe, expect, it } from 'vitest'
import { emptyUiSamples, uiReport, type UiSamples } from '../../src/shared/uiMetrics'

const steps = [
  { name: 'Открыть', start: 1000, ms: 1000, depth: 0 },
  { name: 'Ввести номенклатуру', start: 2000, ms: 3000, depth: 0 },
]

describe('how the page answered input', () => {
  it('nothing typed, clicked or held — nothing to say', () => {
    expect(uiReport(emptyUiSamples(), steps)).toBeUndefined()
  })
  it('all fast — an ok entry that says so', () => {
    const r = uiReport({ ...emptyUiSamples(), counts: { keys: 10, inputs: 10, clicks: 1 } }, steps)
    expect(r).toMatchObject({ kind: 'ui', state: 'ok', summary: 'ввод и клики: 21; каждое быстрее 16 мс' })
  })
  it('a key’s events are one interaction (its longest stands); slow ones warned, on their step and field; the frames’ culprit named', () => {
    const s: UiSamples = {
      counts: { keys: 3, inputs: 3, clicks: 0 },
      events: [
        { name: 'keydown', d: 20, delay: 2, proc: 3, at: 2100, id: 7, target: 'input «Наименование»' },
        // (an input event has no interaction id: it goes with the key it began with; its handlers run inside the key's — counted once)
        { name: 'input', d: 248, delay: 1, proc: 240, at: 2101, id: 0, target: 'input «Наименование»' },
        { name: 'input', d: 120, delay: 1, proc: 110, at: 2600, id: 0, target: 'input «Наименование»' },
        { name: 'click', d: 24, delay: 1, proc: 10, at: 1500, id: 9, target: 'button «Найти»' },
      ],
      frames: [
        { d: 260, block: 210, at: 2104, scripts: [{ src: 'https://x.test/assets/pinia.592ca957.entry.js:2642', fn: '$subscribe', inv: 'input event', d: 236 }] },
        { d: 130, block: 80, at: 2600, scripts: [{ src: 'https://x.test/assets/pinia.592ca957.entry.js:2642', fn: '$subscribe', inv: 'input event', d: 100 }] },
      ],
    }
    const r = uiReport(s, steps)!
    expect(r.state).toBe('warn')
    expect(r.summary).toBe('ввод и клики: 6; медленных (>100 мс): 2, худшее 249 мс (задержка 2 мс · обработка 240 мс · отрисовка 7 мс) — input «Наименование» на шаге «Ввести номенклатуру»; долгие кадры (>50 мс): 2, блокировали 290 мс, больше всех держал $subscribe · pinia.592ca957.entry.js:2642 (336 мс)')
    expect(r.rows?.[0]).toEqual(['Ввод и клики', 'Ввести номенклатуру', 'input «Наименование»', 'keydown, input', '249 мс', 'задержка 2 мс · обработка 240 мс · отрисовка 7 мс'])
    expect(r.rows?.at(-1)?.slice(0, 5)).toEqual(['Кто держал кадры', '', '$subscribe · pinia.592ca957.entry.js:2642', 'input event', '336 мс'])
    expect(r.marks).toEqual(['warn', 'ok', 'ok', 'warn'])
  })
})
