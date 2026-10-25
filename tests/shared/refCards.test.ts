import { describe, expect, it } from 'vitest'
import type { JiraIssue } from '../../src/shared/jira'
import { eventBody, isRefCard, jiraBody, REF_TEXT_MAX, refChanges, refUrlsIn, sameBody, type RefCard } from '../../src/shared/transport/refCards'
import { SharedText } from '../../src/shared/transport/sharedText'

const issue = (over: Partial<JiraIssue> = {}): JiraIssue => ({
  key: 'ABC-1',
  summary: 'Задача',
  status: 'В работе',
  category: 'indeterminate',
  project: { key: 'ABC', name: 'Проект' },
  type: 'Story',
  mine: true,
  updated: 100,
  description: 'Описание',
  ...over,
})
const JIRA = 'qvarch://jira/ABC-1'
const EVENT = 'qvarch://event/2026-10-20/e1'
const ev = eventBody({ day: '2026-10-20', label: 'Встреча', start: 1, end: 2, kind: { label: 'Встреча', color: '#f00', icon: 'tag' }, outlook: false })
const card = (b: ReturnType<typeof jiraBody>, by = 'dev-b', at = 5): RefCard => ({ ...b, by, at })

describe('task and event snapshots of a shared note', () => {
  it('the links of a text: tasks and events, each once; other links — not', () => {
    const text = `[ABC-1 Задача](${JIRA}) и снова [ABC-1](${JIRA}), [Встреча](${EVENT}), [сайт](https://x.ru), [[Заметка]]`
    expect(refUrlsIn(text)).toEqual([JIRA, EVENT])
  })
  it("a task's snapshot: no personal fields, the description cut, the address when the site is known", () => {
    const b = jiraBody(issue({ description: 'а'.repeat(REF_TEXT_MAX + 10), estimateSec: 60, priorityId: '1' }), 'https://jira.example/')
    expect(b.kind === 'jira' && b.issue).not.toHaveProperty('mine')
    expect(b.kind === 'jira' && b.issue).not.toHaveProperty('estimateSec')
    expect(b.kind === 'jira' && b.issue.description!.length).toBeLessThan(REF_TEXT_MAX + 30)
    expect(b.kind === 'jira' && b.url).toBe('https://jira.example/browse/ABC-1')
  })
  it('the same snapshot whatever its fields order, who wrote it and when', () => {
    const a = card(jiraBody(issue()), 'dev-a', 1)
    const b = { ...card(jiraBody(issue()), 'dev-b', 9) }
    expect(sameBody(a, b)).toBe(true)
    expect(sameBody(a, card(jiraBody(issue({ status: 'Готово' }))))).toBe(false)
  })
  it('put in what this person knows and is not kept yet; the unknown kept as someone wrote it; the unlinked taken out', () => {
    const kept = new Map<string, RefCard>([
      [EVENT, { ...ev, by: 'dev-b', at: 1 }],
      ['qvarch://jira/OLD-1', card(jiraBody(issue({ key: 'OLD-1' })))],
    ])
    const r = refChanges([JIRA, EVENT], kept, (u) => (u === JIRA ? jiraBody(issue()) : undefined))
    expect(r.put.map(([u]) => u)).toEqual([JIRA])
    expect(r.drop).toEqual(['qvarch://jira/OLD-1'])
  })
  it("a task: an older copy never overwrites a newer one (two members' Jira do not fight)", () => {
    const kept = new Map([[JIRA, card(jiraBody(issue({ updated: 200, status: 'Готово' })))]])
    expect(refChanges([JIRA], kept, () => jiraBody(issue({ updated: 100 }))).put).toEqual([])
    expect(refChanges([JIRA], kept, () => jiraBody(issue({ updated: 300, status: 'Закрыта' }))).put).toHaveLength(1)
  })
  it('a malformed snapshot (written by anyone) is not taken', () => {
    expect(isRefCard({ kind: 'jira', by: 'x', at: 1 })).toBe(false)
    expect(isRefCard({ kind: 'other', by: 'x', at: 1 })).toBe(false)
    expect(isRefCard({ ...ev, by: 'x', at: 1 })).toBe(true)
  })
  it('kept in the shared document: the other member reads it, taken out — gone for both', () => {
    const a = new SharedText()
    const b = new SharedText()
    a.onUpdate((u, o) => o === 'local' && b.apply(u, 'remote'))
    let told = 0
    b.onRefs(() => told++)
    a.putRefs([[JIRA, card(jiraBody(issue()))]], [])
    expect(b.refsNow().get(JIRA)?.kind).toBe('jira')
    expect(told).toBe(1)
    a.putRefs([], [JIRA])
    expect(b.refsNow().size).toBe(0)
  })
})
