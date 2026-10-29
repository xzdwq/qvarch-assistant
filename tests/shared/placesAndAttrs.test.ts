import { describe, expect, it } from 'vitest'
import { DEFAULT_IN_TOOLS, headerIds, moveSection, placeOf, reorderTools, TOOL_IDS, toolsIds } from '../../src/shared/places'
import { mergeUi, DEFAULT_UI } from '../../src/shared/ui'
import { attrChips, attrDim, attrRemovals, cleanAttrs, cleanShort, offeredAttrs, withoutRemoved, type AttrDef } from '../../src/shared/tracker/attributes'
import { groupItems, matches, type ReportItem } from '../../src/shared/report'
import { attrBreakdown } from '../../src/shared/tracker/reportStats'
import type { Entry } from '../../src/shared/types'

const VIEWS = ['work', 'notebook', 'release', 'browser', 'http', 'terminal', 'tools'] as const

describe('the sections: on the bar or in «Инструменты»', () => {
  const menu = { order: [], hidden: [], tools: [...DEFAULT_IN_TOOLS] }
  it('by default Релиз and HTTP stand in «Инструменты», before its own tools; Терминал — on the bar (never in them)', () => {
    expect(headerIds(menu, VIEWS)).toEqual(['work', 'notebook', 'browser', 'terminal', 'tools'])
    expect(toolsIds(menu)).toEqual(['release', 'http', ...TOOL_IDS])
    expect(placeOf({ ...menu, tools: ['terminal'] }, 'terminal')).toBe('header')
    expect(placeOf(menu, 'http')).toBe('tools')
    expect(placeOf(menu, 'diff')).toBe('tools')
  })
  it('older settings (no «tools») get the default on reading', () => {
    expect(mergeUi(DEFAULT_UI, { menu: { order: ['notebook'], hidden: [] } as never }).menu.tools).toEqual([...DEFAULT_IN_TOOLS])
  })
  it('a section kept in «Инструменты» that may stand there no more: out of them, hidden on the bar (off it, as it was)', () => {
    const m = mergeUi(DEFAULT_UI, { menu: { order: [], hidden: ['http'], tools: ['release', 'terminal', 'diff'] } }).menu
    expect(m.tools).toEqual(['release', 'diff'])
    expect(m.hidden).toEqual(['http', 'terminal'])
  })
  it('a section moved back to the bar goes to its end, shown; moved into the tools — to their end', () => {
    const bar = headerIds(menu, VIEWS)
    const back = moveSection(menu, 'http', 'header', bar)
    expect(headerIds(back, VIEWS)).toEqual(['work', 'notebook', 'browser', 'terminal', 'tools', 'http'])
    expect(toolsIds(back)).not.toContain('http')
    const into = moveSection({ ...menu, hidden: ['browser'] }, 'browser', 'tools', bar)
    expect(toolsIds(into).at(-1)).toBe('browser')
    expect(headerIds(into, VIEWS)).toEqual(['work', 'notebook', 'terminal', 'tools'])
    expect(into.hidden).toEqual([])
  })
  it('the tools sorted as dragged; unknown ids dropped', () => {
    const m = reorderTools(menu, ['pdf', 'http', 'terminal', 'nope', 'diff'])
    expect(toolsIds(m).slice(0, 3)).toEqual(['pdf', 'http', 'diff'])
  })
})

const PRJ: AttrDef = { id: 'prj', name: 'Проект', short: 'ПРО', color: '#336699', active: true, options: [{ id: 'a', label: 'Альфа' }, { id: 'b', label: 'Бета' }] }
const entry = (id: string, attrs?: Record<string, string>): Entry => ({ id, start: 0, end: 3_600_000, kind: 'task', label: id, source: 'manual', ...(attrs ? { attrs } : {}) })

describe('attributes of events', () => {
  it('letters: up to three, capital; none typed — from the name', () => {
    expect(cleanShort('proj', 'Проект')).toBe('PRO')
    expect(cleanShort('', 'клиент')).toBe('КЛИ')
  })
  it('offered: the active ones and the ones the event has (turned off — kept there, not offered to others)', () => {
    const off = { ...PRJ, id: 'old', active: false }
    expect(offeredAttrs([PRJ, off]).map((a) => a.id)).toEqual(['prj'])
    expect(offeredAttrs([PRJ, off], { old: 'x' }).map((a) => a.id)).toEqual(['prj', 'old'])
    expect(attrChips([PRJ], { prj: 'a' })).toEqual([{ id: 'prj', short: 'АЛЬ', name: 'Проект', value: 'Альфа', color: '#336699' }])
  })
  it('deleted — off every event; a value taken out of the list — that value off', () => {
    const lessOptions = { ...PRJ, options: [PRJ.options[0]] }
    const r = attrRemovals([PRJ, { ...PRJ, id: 'gone' }], [lessOptions])
    expect(r.get('gone')).toBe('all')
    expect([...(r.get('prj') as Set<string>)]).toEqual(['b'])
    expect(withoutRemoved(entry('a', { prj: 'b', gone: 'x' }), r)).not.toHaveProperty('attrs')
    expect(withoutRemoved(entry('b', { prj: 'a', gone: 'x' }), r)?.attrs).toEqual({ prj: 'a' })
    expect(withoutRemoved(entry('c', { prj: 'a' }), r)).toBeUndefined()
  })
  it('kept clean in the settings: no nameless ones, no blank values', () => {
    expect(cleanAttrs([{ id: 'x', name: ' ', options: [] }, { id: 'y', name: 'Клиент', options: [{ id: 'o', label: ' ' }] }])).toEqual([{ id: 'y', name: 'Клиент', short: 'КЛИ', color: '#888888', active: true, options: [] }])
  })
  it('a chip shows the value\'s letters (not the attribute\'s)', () => {
    expect(attrChips([PRJ], { prj: 'b' })[0]).toMatchObject({ short: 'БЕТ', name: 'Проект', value: 'Бета' })
  })
  it('the report by attributes: each one\'s values with «Без значения»; one nobody set — left out', () => {
    const items: ReportItem[] = [entry('a', { prj: 'a' }), entry('b')].map((e) => ({ day: '2026-10-24', e }))
    const b = attrBreakdown(items, [PRJ, { ...PRJ, id: 'unused' }])
    expect(b.map((x) => x.def.id)).toEqual(['prj'])
    expect(b[0].rows.map((r) => [r.label, r.count])).toEqual([
      ['Альфа', 1],
      ['Без значения', 1],
    ])
  })
  it('in the reports: a filter by values (none too) and a breakdown by an attribute', () => {
    expect(matches(entry('a', { prj: 'a' }), { attrs: { prj: ['a'] } })).toBe(true)
    expect(matches(entry('b'), { attrs: { prj: ['a'] } })).toBe(false)
    expect(matches(entry('b'), { attrs: { prj: [''] } })).toBe(true)
    const items: ReportItem[] = [entry('a', { prj: 'a' }), entry('b', { prj: 'a' }), entry('c')].map((e) => ({ day: '2026-10-24', e }))
    expect(groupItems(items, attrDim('prj')).map((g) => [g.key, g.count])).toEqual([
      ['a', 2],
      ['', 1],
    ])
  })
})
