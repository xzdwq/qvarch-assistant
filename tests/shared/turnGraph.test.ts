import { describe, expect, it } from 'vitest'
import { touchesOf } from '../../src/shared/agent/touches'
import { leafGone, leafTarget, mainOp, radialLayout, turnGraph } from '../../src/shared/agent/turnGraph'
import { docTurnOf, docAiOf } from '../../src/shared/agent/docAi'

const DOC = 'Работа/Релиз.md'
const turn = (id: string, at: number, calls: Array<[string, Record<string, unknown>, boolean?]>, error?: string) =>
  docTurnOf({ id, at, ms: 1000, agent: 'ИИ · Анна', owner: 'Анна', asker: 'Борис', question: 'q', trace: [], wrote: 0, ...(error ? { error } : {}), touches: calls.flatMap(([tool, a, ok = true], i) => touchesOf(tool, a, DOC, ok, i)) })

describe('what a turn touched', () => {
  it('each tool says what its call touches; a link read — by its kind', () => {
    expect(touchesOf('doc_section', { heading: '## Итоги' }, DOC, true, 0)[0]).toMatchObject({ kind: 'section', op: 'write', ref: `${DOC}#Итоги`, label: 'Итоги' })
    expect(touchesOf('link_read', { link: '[[План#Сроки]]' }, DOC, true, 1)[0]).toMatchObject({ kind: 'section', op: 'read', ref: 'План.md#Сроки' })
    expect(touchesOf('link_read', { link: '[ABC-1 Вход](qvarch://jira/ABC-1)' }, DOC, true, 2)[0]).toMatchObject({ kind: 'jira', ref: 'qvarch://jira/ABC-1' })
    expect(touchesOf('note_run', { path: 'Тесты', block: 'login' }, DOC, false, 3)[0]).toMatchObject({ kind: 'component', op: 'run', ref: 'Тесты.md#login', ok: false })
    expect(touchesOf('jira_issue', { key: 'ABC-2' }, DOC, true, 4)[0]).toMatchObject({ kind: 'jira', ref: 'qvarch://jira/ABC-2' })
    expect(touchesOf('some_new_tool', {}, DOC, true, 5)[0]).toMatchObject({ kind: 'tool', label: 'some_new_tool' })
  })
})

describe('the graph of the AI’s work', () => {
  const turns = [
    turn('t1', 1, [['doc_read', {}], ['link_read', { link: '[[План]]' }], ['doc_section', { heading: 'Итоги' }]]),
    turn('t2', 2, [['link_read', { link: '[[План]]' }], ['notes_search', { query: 'релиз' }], ['note_run', { path: 'Тесты', block: 'login' }, false]], 'модель недоступна'),
  ]
  const groups = turnGraph(turns)
  const leaf = (id: string) => groups.flatMap((g) => g.leaves).find((l) => l.id === id)!
  it('groups what was touched; a thing touched by two turns — one leaf, both turns', () => {
    expect(groups.map((g) => g.id)).toEqual(['doc', 'notes', 'search', 'components', 'errors'])
    expect(leaf('note:План.md')).toMatchObject({ turns: ['t1', 't2'], ops: { read: 2 } })
    expect(leaf('component:Тесты.md#login').failed).toBe(1)
    expect(leaf('error:t2').label).toBe('модель недоступна')
  })
  it('a leaf’s colour — what was done most (writing first); where a click goes', () => {
    expect(mainOp(leaf(`section:${DOC}#Итоги`))).toBe('write')
    expect(leafTarget(leaf(`section:${DOC}#Итоги`))).toEqual({ note: DOC, part: 'Итоги' })
    expect(leafTarget(leaf('search:релиз'))).toBeUndefined()
    expect(leafTarget({ kind: 'jira', ref: 'qvarch://jira/ABC-1' })).toEqual({ url: 'qvarch://jira/ABC-1' })
  })
  it('laid out round the middle: each group on the inner ring, its leaves on the outer one', () => {
    const l = radialLayout(groups, 100, 200)
    expect(l.groups).toHaveLength(groups.length)
    expect(l.leaves).toHaveLength(groups.reduce((n, g) => n + g.leaves.length, 0))
    for (const g of l.groups) expect(Math.round(Math.hypot(g.x, g.y))).toBe(100)
    for (const x of l.leaves) expect(Math.round(Math.hypot(x.x, x.y))).toBe(200)
  })
  it('what is no longer there: a note deleted, a section or a block gone; a note not read yet — not judged', () => {
    const notes: Record<string, string | undefined> = { [DOC]: '# Релиз\n\n## План\n', 'Тесты.md': '```pw name=login\n```' }
    const find = (n: string) => (n in notes ? n : undefined)
    const textOf = (p: string) => notes[p]
    expect(leafGone({ kind: 'section', ref: `${DOC}#Итоги` }, find, textOf)).toBe(true)
    expect(leafGone({ kind: 'section', ref: `${DOC}#План` }, find, textOf)).toBe(false)
    expect(leafGone({ kind: 'component', ref: 'Тесты.md#login' }, find, textOf)).toBe(false)
    expect(leafGone({ kind: 'component', ref: 'Тесты.md#logout' }, find, textOf)).toBe(true)
    expect(leafGone({ kind: 'note', ref: 'Удалённая.md' }, find, textOf)).toBe(true)
    expect(leafGone({ kind: 'section', ref: 'Непрочитанная.md#X' }, (n) => n, () => undefined)).toBe(false)
    expect(leafGone({ kind: 'jira', ref: 'qvarch://jira/ABC-1' }, find, textOf)).toBe(false)
  })
  it('the touches kept in the journal (read back safely)', () => {
    expect(docAiOf({ turns: [{ ...turns[0], touches: [...turns[0].touches!, { kind: 'bad' }] }] }).turns[0].touches).toHaveLength(3)
  })
})
