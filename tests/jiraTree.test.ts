import { describe, expect, it } from 'vitest'
import type { JiraIssue } from '../src/shared/jira'
import { taskTree } from '../src/shared/jiraTree'
import { jiraColumnsOf, jiraGridOf, DEFAULT_JIRA_COLUMNS } from '../src/shared/jiraColumns'
import { fetchAncestors } from '../src/main/jira/jiraAncestors'
import { jiraIssueFrom, parentFieldsOf } from '../src/main/jira/jiraIssueMapping'
import { findIssues } from '../src/main/jira/jiraQueries'

const task = (key: string, parent?: string, over: Partial<JiraIssue> = {}): JiraIssue => ({
  key,
  summary: key,
  status: 'Open',
  category: 'new',
  project: { key: key.split('-')[0], name: key.split('-')[0] },
  type: 'Task',
  mine: false,
  updated: 0,
  ...(parent ? { parent: { key: parent, summary: '' } } : {}),
  ...over,
})
const known = (...xs: JiraIssue[]) => new Map(xs.map((x) => [x.key, x]))
const shape = (rows: ReturnType<typeof taskTree>) => rows.map((r) => `${'  '.repeat(r.depth ?? 0)}${r.key}${r.context ? '*' : ''}`)

describe('the tasks as a tree of their parents', () => {
  const solution = task('AI-11', undefined, { type: 'Solution', level: 2 })
  const epic = task('AI-113', 'AI-11', { type: 'Epic', level: 1 })
  const story = task('AI-114', 'AI-113', { type: 'Story', level: 0 })
  const tasks = ['AI-123', 'AI-124', 'AI-125', 'AI-126'].map((k) => task(k, 'AI-114', { type: 'Sub-task', level: -1 }))
  const all = known(solution, epic, story, ...tasks)

  it('solution → epic → story → tasks; the ancestors not found — context (*)', () => {
    expect(shape(taskTree(tasks, all, new Set()))).toEqual(['AI-11*', '  AI-113*', '    AI-114*', '      AI-123', '      AI-124', '      AI-125', '      AI-126'])
  })
  it('a found ancestor is no context; each level in the list’s order', () => {
    const rows = taskTree([tasks[2], story, tasks[0]], all, new Set())
    expect(shape(rows)).toEqual(['AI-11*', '  AI-113*', '    AI-114', '      AI-125', '      AI-123'])
  })
  it('a folded task hides what is under it, its count kept', () => {
    const rows = taskTree(tasks, all, new Set(['AI-113']))
    expect(shape(rows)).toEqual(['AI-11*', '  AI-113*'])
    expect(rows[1]).toMatchObject({ folded: true, children: 1, inside: 4 })
  })
  it('a parent not known — the task is a root; a cycle is cut', () => {
    expect(shape(taskTree([task('X-1', 'X-0')], known(task('X-1', 'X-0')), new Set()))).toEqual(['X-1'])
    const a = task('C-1', 'C-2')
    const b = task('C-2', 'C-1')
    expect(taskTree([a], known(a, b), new Set()).map((r) => r.key)).toEqual(['C-2', 'C-1'])
  })
  it('a branch stays under its root’s project (a task of another project under it)', () => {
    const other = task('OPS-7', 'AI-114')
    const rows = taskTree([other], known(solution, epic, story, other), new Set())
    expect(rows.every((r) => r.section === 'AI')).toBe(true)
  })
})

describe('the ancestors fetched apart', () => {
  it('level by level up; an unreadable key left out, the rest of its batch fetched', async () => {
    const remote = known(task('E-1', 'S-1'), task('S-1'), task('E-2'))
    const asked: string[][] = []
    const fetch = async (keys: string[]) => {
      asked.push(keys)
      if (keys.includes('GONE-1')) throw new Error('Jira 400: issue does not exist')
      return keys.map((k) => remote.get(k)!)
    }
    const got = await fetchAncestors([task('T-1', 'E-1'), task('T-2', 'GONE-1'), task('T-3', 'E-2')], () => false, fetch)
    expect(got.map((i) => i.key).sort()).toEqual(['E-1', 'E-2', 'S-1'])
  })
  it('a lost connection is no bad key — it goes up', async () => {
    await expect(fetchAncestors([task('T-1', 'E-1')], () => false, async () => Promise.reject(new Error('ECONNRESET')))).rejects.toThrow('ECONNRESET')
  })
})

describe('a task’s parent and level from Jira', () => {
  it('Jira’s own parent first; a site’s «Parent Link» / «Epic Link» found by schema', () => {
    const fields = parentFieldsOf([{ id: 'customfield_1', schema: { custom: 'com.atlassian.jpo:jpo-custom-field-parent' } }, { id: 'customfield_2', schema: { custom: 'com.pyxis.greenhopper.jira:gh-epic-link' } }, { id: 'summary' }])
    expect(fields).toEqual({ customfield_1: 'com.atlassian.jpo:jpo-custom-field-parent', customfield_2: 'com.pyxis.greenhopper.jira:gh-epic-link' })
    expect(jiraIssueFrom('A-1', { parent: { key: 'A-0', fields: { summary: 'P' } } }, undefined, fields).parent).toEqual({ key: 'A-0', summary: 'P' })
    expect(jiraIssueFrom('A-2', { customfield_1: { data: { key: 'A-11' } } }, undefined, fields).parent?.key).toBe('A-11')
    expect(jiraIssueFrom('A-3', { customfield_2: 'A-5' }, undefined, fields).parent?.key).toBe('A-5')
  })
  it('the type’s level, the author and the creator', () => {
    const i = jiraIssueFrom('A-1', { issuetype: { name: 'Epic', hierarchyLevel: 1 }, reporter: { displayName: 'R' }, creator: { displayName: 'C' } })
    expect(i).toMatchObject({ level: 1, reporter: 'R', creator: 'C' })
  })
})

describe('the fields shown', () => {
  it('kept ones in the registry’s order, unknown dropped; none kept — the default', () => {
    expect(jiraColumnsOf(['due', 'gone', 'type'])).toEqual(['type', 'due'])
    expect(jiraColumnsOf(null)).toEqual(DEFAULT_JIRA_COLUMNS)
  })
  it('the grid: a track per field with a width (chips in the title take none)', () => {
    expect(jiraGridOf(['type', 'labels', 'due'])).toBe('18px 18px 84px minmax(0,1fr) 96px 48px 28px')
  })
})

describe('the list as a tree', () => {
  it('the filters pick the tasks; their parents come along as context; the page is of rows', () => {
    const story = task('AI-114', 'AI-113', { category: 'done', status: 'Done' })
    const r = findIssues([task('AI-123', 'AI-114'), task('AI-124', 'AI-114', { status: 'Other' })], {
      q: '',
      offset: 0,
      limit: 50,
      mode: 'list',
      query: { view: 'tree', statuses: ['Open'] },
      starred: [],
      today: '2026-10-29',
      parents: [story, task('AI-113')],
    })
    expect(r.items.map((i) => `${i.key}${i.context ? '*' : ''}`)).toEqual(['AI-113*', 'AI-114*', 'AI-123'])
    expect(r.total).toBe(3)
    expect(r.found).toBe(1)
  })
})
