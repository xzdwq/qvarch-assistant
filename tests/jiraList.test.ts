import { describe, expect, it } from 'vitest'
import { listTasks, priorityRank, type JiraIssue } from '../src/shared/jira'

const T = (key: string, x: Partial<JiraIssue> = {}): JiraIssue => ({
  key,
  summary: key,
  status: 'Открыта',
  category: 'new',
  project: { key: key.split('-')[0], name: '' },
  type: 'Задача',
  mine: false,
  updated: 0,
  ...x,
})
const keys = (l: JiraIssue[]) => l.map((i) => i.key)
const TODAY = '2026-10-20'

describe('the Jira task list', () => {
  const list = [
    T('A-1', { created: 100, due: '2026-10-10', priority: 'Low', priorityId: '4', mine: true }),
    T('A-2', { created: 300, priority: 'Highest', priorityId: '1', status: 'В работе', category: 'indeterminate' }),
    T('A-3', { created: 200, due: '2026-10-25', priority: 'Medium', priorityId: '3' }),
    T('B-1', { created: 999 }),
  ]
  it('newest first by default, inside each project', () => {
    expect(keys(listTasks(list, {}, TODAY))).toEqual(['A-2', 'A-3', 'A-1', 'B-1'])
    expect(keys(listTasks(list, { desc: false }, TODAY))).toEqual(['A-1', 'A-3', 'A-2', 'B-1'])
  })
  it('the due date and the priority: the empty ones last either way', () => {
    expect(keys(listTasks(list, { sort: 'due', desc: false }, TODAY))).toEqual(['A-1', 'A-3', 'A-2', 'B-1'])
    expect(keys(listTasks(list, { sort: 'due' }, TODAY))).toEqual(['A-3', 'A-1', 'A-2', 'B-1'])
    expect(keys(listTasks(list, { sort: 'priority' }, TODAY))).toEqual(['A-2', 'A-3', 'A-1', 'B-1'])
  })
  it('the filters: several values — any of them; different filters — all of them', () => {
    expect(keys(listTasks(list, { assignee: ['mine'] }, TODAY))).toEqual(['A-1'])
    expect(keys(listTasks(list, { assignee: ['mine', 'other'] }, TODAY))).toHaveLength(4)
    expect(keys(listTasks(list, { due: ['late', 'week'] }, TODAY))).toEqual(['A-3', 'A-1'])
    expect(keys(listTasks(list, { due: ['none'], statuses: ['В работе'] }, TODAY))).toEqual(['A-2'])
    expect(keys(listTasks(list, { priorities: ['Low', 'Medium'] }, TODAY))).toEqual(['A-3', 'A-1'])
  })
  it('a priority by its name (in Russian too), else by the standard id', () => {
    expect(priorityRank({ priority: 'Высокий' })).toBe(2)
    expect(priorityRank({ priority: 'Срочно', priorityId: '1' })).toBe(1)
    expect(priorityRank({ priority: 'Срочно', priorityId: '10001' })).toBe(6)
  })
})
