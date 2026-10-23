import { describe, expect, it } from 'vitest'
import type { JiraIssue, JiraVersion } from '../../src/shared/jira'
import { netReason } from '../../src/main/jira/netReason'
import { jiraIssueFrom, validProjectKeys } from '../../src/main/jira/jiraIssueMapping'
import { findIssues, findVersions } from '../../src/main/jira/jiraQueries'

describe('jira: network failures in words', () => {
  it('knows Chromium and Node codes', () => {
    expect(netReason(new Error('net::ERR_NAME_NOT_RESOLVED'))).toBe('адрес не найден (DNS, VPN?)')
    expect(netReason({ message: 'fetch failed', cause: { code: 'ECONNREFUSED' } })).toBe('соединение отклонено')
    expect(netReason(new Error('net::ERR_CERT_AUTHORITY_INVALID'))).toBe('сертификат не принят')
  })
  it('an unknown one keeps its own message; nothing at all — a plain phrase', () => {
    expect(netReason(new Error('  something odd  '))).toBe('something odd')
    expect(netReason({ message: '' })).toBe('неизвестная ошибка сети')
  })
})

describe('jira: an issue from its fields', () => {
  const fields = {
    summary: 'Fix the form',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    project: { key: 'ABC', name: 'Alpha' },
    issuetype: { name: 'Bug' },
    priority: { name: 'High', id: 2 },
    duedate: '2026-01-10',
    assignee: { displayName: 'Someone', accountId: 'me-1' },
    updated: '2026-01-01T10:00:00.000+0000',
    components: [{ name: 'UI' }, { name: '' }, null],
    labels: ['front', 7],
    fixVersions: [],
    parent: { key: 'ABC-1', fields: { summary: 'Epic' } },
  }
  it('maps the fields the app shows', () => {
    const i = jiraIssueFrom('ABC-12', fields, 'me-1')
    expect(i).toMatchObject({ key: 'ABC-12', summary: 'Fix the form', status: 'In Progress', category: 'indeterminate', project: { key: 'ABC', name: 'Alpha' }, type: 'Bug', priority: 'High', priorityId: '2', due: '2026-01-10', mine: true })
    expect(i.components).toEqual(['UI'])
    expect(i.labels).toEqual(['front', '7'])
    expect(i.versions).toBeUndefined()
    expect(i.parent).toEqual({ key: 'ABC-1', summary: 'Epic' })
    expect(i.updated).toBe(Date.parse(fields.updated))
  })
  it('someone else\'s task, an unknown category, no project — from the key', () => {
    const i = jiraIssueFrom('XYZ-3', { status: { statusCategory: { key: 'weird' } } }, 'me-1')
    expect(i).toMatchObject({ mine: false, category: 'new', project: { key: 'XYZ', name: '' }, summary: '', updated: 0 })
    expect(jiraIssueFrom('XYZ-4', { status: { statusCategory: { key: 'done' } } }).category).toBe('done')
  })
  it('only real project keys go into JQL', () => {
    expect(validProjectKeys(['ABC', 'a-b', 'X', 'R2_D2', 'ABC) OR (1=1'])).toEqual(['ABC', 'R2_D2'])
  })
})

/** A task with only what the search reads. */
function task(key: string, p: Partial<JiraIssue> = {}): JiraIssue {
  return { key, summary: key, status: 'Open', category: 'new', project: { key: key.split('-')[0], name: '' }, type: 'Task', updated: 0, ...p } as JiraIssue
}

describe('jira: the task search', () => {
  const issues = [
    task('B-1', { due: '2026-02-01', description: 'about payments' }),
    task('A-2', { category: 'indeterminate', status: 'Doing', labels: ['ui'] }),
    task('A-1', { due: '2026-01-01', priority: 'Low', priorityId: '4' }),
    task('A-3', { category: 'done' }),
    task('C-1', { mine: true, priority: 'High', priorityId: '2' }),
  ]
  const base = { q: '', offset: 0, limit: 50, mode: 'list' as const, starred: [], today: '2026-01-15' }

  it('lists the open ones by project, then due date; without descriptions', () => {
    const r = findIssues(issues, base)
    expect(r.items.map((i) => i.key)).toEqual(['A-1', 'A-2', 'B-1', 'C-1'])
    expect(r.total).toBe(4)
    expect(r.items.every((i) => i.description === undefined)).toBe(true)
  })
  it('the words search the description too, and all must match', () => {
    expect(findIssues(issues, { ...base, q: 'PAYMENTS' }).items.map((i) => i.key)).toEqual(['B-1'])
    expect(findIssues(issues, { ...base, q: 'payments ui' }).total).toBe(0)
  })
  it('picking: mine and starred first', () => {
    const r = findIssues(issues, { ...base, mode: 'pick', starred: ['B-1'] })
    expect(r.items.slice(0, 2).map((i) => i.key)).toEqual(['B-1', 'C-1'])
  })
  it('pages and facets', () => {
    const r = findIssues(issues, { ...base, offset: 1, limit: 2 })
    expect(r.items.map((i) => i.key)).toEqual(['A-2', 'B-1'])
    expect(r.facets.statuses).toEqual(['Doing', 'Open'])
    expect(r.facets.labels).toEqual(['ui'])
    expect(r.facets.priorities).toEqual(['High', 'Low'])
  })
})

describe('jira: the release search', () => {
  const v = (id: string, p: Partial<JiraVersion>): JiraVersion => ({ id, name: id, project: 'ABC', released: false, archived: false, ...p })
  const versions = [
    v('1.0', { released: true, releaseDate: '2025-01-01' }),
    v('1.1', { released: true, releaseDate: '2025-06-01' }),
    v('2.0', { releaseDate: '2026-03-01' }),
    v('1.9', { releaseDate: '2026-02-01' }),
    v('0.1', { archived: true }),
  ]
  it('the unreleased first (nearest first), then the released (latest first); archived left out', () => {
    const r = findVersions(versions, '', 0, 10)
    expect(r.items.map((x) => x.id)).toEqual(['1.9', '2.0', '1.1', '1.0'])
    expect(r.unreleased).toBe(2)
    expect(r.total).toBe(4)
  })
  it('a search and a page', () => {
    expect(findVersions(versions, 'abc 1.', 1, 1).items.map((x) => x.id)).toEqual(['1.1'])
  })
})
