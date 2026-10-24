import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_BLOCK_SPECS, BLOCK_SPECS, RUNNABLE_KINDS } from '../../src/notebook/blocks/specs'
import { fenceHeaderOf } from '../../src/notebook/domain/findBlocks'
import type { BlockKind } from '../../src/notebook/domain/blockSpec'
import { matchCommands, MENU_ORDER, NOTE_COMMANDS, pickerMode, unorderedCommandIds } from '../../src/notebook/commands/registry'
import type { CommandContext } from '../../src/notebook/commands/command'

describe('block registry', () => {
  it('has one spec per kind, keyed by its kind', () => {
    for (const [k, s] of Object.entries(BLOCK_SPECS)) expect(s.kind).toBe(k)
    expect(ALL_BLOCK_SPECS).toHaveLength(24)
    expect([...RUNNABLE_KINDS].sort()).toEqual(['code', 'http', 'pw', 'sql', 'tpl'])
  })
  it('a fence is recognized by one spec at most', () => {
    const infos = ['http', 'rest name=x', 'md template', 'markdown template name=t', 'md', 'sql', 'sql db=', 'sql db=a name=b', 'js', 'js run', 'ts lib', 'ts playwright', 'ts playwright lib', 'ts playwright run', 'javascript pw headed', 'typescript run lib', 'json', 'json name=a', 'json ref=a', 'json ref=a name=b', 'yaml name=a', 'yaml ref=a', 'chart', 'chart x', 'mermaid', 'toc', 'work', 'board', 'regress', 'files', 'browser', 'browser name=x', 'BROWSER', 'Chart']
    for (const line of infos) {
      const [lang = '', ...rest] = line.split(' ')
      const h = fenceHeaderOf(lang, rest.join(' '))
      const hits = ALL_BLOCK_SPECS.filter((s) => s.detect.by === 'fence' && s.detect.matches(h)).map((s) => s.kind)
      expect(hits.length, `${line}: ${hits.join(', ')}`).toBeLessThanOrEqual(1)
    }
  })
  it('estimates heights as the editor did', () => {
    const lines = (n: number) => Array(n).fill('x').join('\n')
    const h = (k: BlockKind, src: string) => BLOCK_SPECS[k].estimateHeight(src)
    expect(h('http', lines(3))).toBe(200)
    expect(h('code', lines(3))).toBe(200)
    expect(h('sql', lines(3))).toBe(200)
    expect(h('tpl', lines(3))).toBe(200)
    expect(h('loop', lines(3))).toBe(200)
    expect(h('loopEnd', lines(1))).toBe(26)
    expect(h('pw', lines(3))).toBe(240)
    expect(h('browser', 'x\nheight: 300')).toBe(410)
    expect(h('browser', 'x')).toBe(670)
    expect(h('data', lines(5))).toBe(90)
    expect(h('ref', lines(5))).toBe(90)
    expect(h('audio', lines(1))).toBe(48)
    expect(h('image', lines(1))).toBe(320)
    expect(h('board', lines(3))).toBe(560)
    expect(h('regress', lines(3))).toBe(320)
    expect(h('files', lines(3))).toBe(220)
    expect(h('table', lines(4))).toBe(160)
    expect(h('chart', lines(4))).toBe(400)
    expect(h('mermaid', lines(4))).toBe(300)
    expect(h('toc', lines(2))).toBe(112)
    expect(h('callout', lines(2))).toBe(88)
    expect(h('toggle', lines(2))).toBe(88)
    expect(h('work', lines(2))).toBe(88)
  })
  it('only a line of its own cannot be edited as Markdown', () => {
    expect(ALL_BLOCK_SPECS.filter((s) => !s.rawEditable).map((s) => s.kind)).toEqual(['audio', 'image'])
  })
})

describe('«@» commands', () => {
  const ctx = (o: Partial<CommandContext> = {}): CommandContext => ({
    latin: false,
    notePath: 'dir/My note.md',
    freeName: (b) => `${b}2`,
    newestListName: () => 'rows',
    lastValueName: () => 'last',
    firstDbConnection: () => 'main',
    currentSiteUrl: () => 'https://site/',
    now: () => new Date(2026, 9, 23),
    newId: () => 'id1',
    ...o,
  })
  const run = (id: string, o?: Partial<CommandContext>) => NOTE_COMMANDS.find((c) => c.id === id)!.run(ctx(o))
  it('every command is in the menu once, in its order', () => {
    expect(unorderedCommandIds()).toEqual([])
    expect(new Set(MENU_ORDER).size).toBe(MENU_ORDER.length)
    expect(NOTE_COMMANDS.map((c) => c.title)).toEqual(['Аудио', 'Эмодзи', 'HTTP-запрос', 'Playwright', 'Запрос к БД', 'Перебор параметров запроса', 'Тестовые файлы', 'Регрессия', 'Браузер', 'Цикл', 'Текст по шаблону', 'Код JS / TS', 'Данные JSON', 'Значение переменной', 'Работа', 'Доска', 'Чат', 'Таблица', 'График', 'Схема', 'Выноска', 'Свёртка', 'Оглавление', 'Изображение', 'Чек-лист', 'Код', 'Разделитель', 'Дата'])
  })
  it('finds commands by a word start, Russian or English', () => {
    expect(matchCommands('ауд').map((c) => c.id)).toEqual(['audio'])
    expect(matchCommands('aud').map((c) => c.id)).toEqual(['audio'])
    expect(matchCommands('').length).toBe(NOTE_COMMANDS.length)
    expect(pickerMode('table 3x4')).toEqual({ mode: 'table', c: 3, r: 4 })
    expect(pickerMode('эмодзи сердце')).toEqual({ mode: 'emoji', q: 'сердце' })
    expect(pickerMode('доска')).toEqual({ mode: 'board', q: '' })
  })
  it('a whole word above a word\'s start above a part of a word; synonyms; the menu\'s order between equals', () => {
    expect(matchCommands('curl')[0].id).toBe('http')
    expect(matchCommands('query')[0].id).toBe('sql')
    // «запрос» is HTTP's and the query's whole word — both, in the menu's order, before the ones it only starts
    expect(matchCommands('запрос').map((c) => c.id).slice(0, 3)).toEqual(['http', 'sql', 'fuzz'])
    // a part of a word — from three letters, after the starts
    expect(matchCommands('лиц').map((c) => c.id)).toEqual(['table'])
    expect(matchCommands('ли').map((c) => c.id)).not.toContain('table')
  })
  it('typed with what it is about: offered first, inserted filled in', () => {
    const [get] = matchCommands('get https://x.test/a')
    expect(get.title).toBe('HTTP: GET https://x.test/a')
    expect(get.run(ctx())).toEqual({ kind: 'insertBlock', markdown: '```http name=resp2\nGET https://x.test/a\n```' })
    const [sel] = matchCommands('select * from t')
    expect(sel.run(ctx())).toEqual({ kind: 'insertBlock', markdown: '```sql db=main name=rows2\nselect * from t\n```' })
    expect(pickerMode('table3x4')).toEqual({ mode: 'table', c: 3, r: 4 })
  })
  it('inserts what the editor inserted before', () => {
    expect(run('audio')).toEqual({ kind: 'request', action: 'record' })
    expect(run('image')).toEqual({ kind: 'request', action: 'pickImage' })
    expect(run('emoji')).toEqual({ kind: 'insertText', text: '@эмодзи ', keepMenu: true })
    expect(run('emoji', { latin: true })).toEqual({ kind: 'insertText', text: '@emoji ', keepMenu: true })
    expect(run('table', { latin: true })).toEqual({ kind: 'insertText', text: '@table ', keepMenu: true })
    expect(run('board')).toEqual({ kind: 'insertText', text: '@доска ', keepMenu: true })
    expect(run('todo')).toEqual({ kind: 'insertText', text: '- [ ] ' })
    expect(run('code')).toEqual({ kind: 'insertText', text: '```', complete: true })
    expect(run('date')).toEqual({ kind: 'insertText', text: '23 октября 2026 ' })
    const md = (id: string, o?: Partial<CommandContext>) => (run(id, o) as { markdown: string }).markdown
    expect(md('divider')).toBe('---')
    expect(md('toc')).toBe('```toc\n```')
    expect(md('http')).toBe('```http name=resp2\nGET https://\n```')
    expect(md('browser')).toBe('```browser name=site2\nurl: about:blank\nheight: 560\n```')
    expect(md('pw')).toBe("```ts playwright name=scenario2\nawait page.goto('https://example.com')\nawait expect(page).toHaveTitle(/Example/)\nreturn await page.title()\n```")
    expect(md('js')).toBe('```js run name=result2\n\n```')
    expect(md('tpl')).toBe('```md template name=text2\n✅ **{{ rows }}**\n```')
    expect(md('tpl', { newestListName: () => undefined })).toBe('```md template name=text2\n✅ **{{ value }}**\n```')
    expect(md('data')).toBe('```json name=data2\n[]\n```')
    expect(md('ref')).toBe('```json ref=last\n```')
    expect(md('ref', { lastValueName: () => undefined })).toBe('```json ref=value\n```')
    expect(md('sql')).toBe('```sql db=main name=rows2\nselect \n```')
    expect(md('loop')).toBe('<!-- qa:loop name=passes2 -->\n```js loop\n\n```\n\n<!-- /qa:loop -->')
    expect(md('files')).toBe('```files\n{\n  "set": "My note"\n}\n```')
    expect(md('files', { notePath: '' })).toBe('```files\n{\n  "set": "Файлы"\n}\n```')
    expect(md('regress')).toBe('```regress\n{\n  "id": "id1",\n  "folder": "",\n  "deep": true\n}\n```')
    expect(md('work')).toBe('```work\nperiod: today\nview: table\n```')
    expect(md('callout')).toBe('> [!info]\n>')
    expect(md('toggle')).toBe('<details open>\n<summary></summary>\n\n\n\n</details>')
    expect(md('mermaid').startsWith('```mermaid\nflowchart LR')).toBe(true)
    expect(md('chart').startsWith('```chart\ntype: bar\ntitle: Новый график')).toBe(true)
    expect(md('fuzz').split('\n').slice(0, 3)).toEqual(['```ts playwright name=fuzz2 session', 'await page.goto("https://site/")', 'await qa.fuzz('])
  })
})

/** The pure parts of the notebook (the domain, the specs, the commands, the run engine) never reach the UI. */
describe('notebook layers', () => {
  const root = join(__dirname, '../../src/notebook')
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]))
  const pure = files(root).filter((f) => /[\\/](domain|commands|engine)[\\/].*\.ts$|[\\/]blocks[\\/][^\\/]+\.ts$|[\\/]blocks[\\/][^\\/]+[\\/](spec|model|run|httpText)\.ts$/.test(f))
  it('pure modules import no Vue component, no renderer module, no CodeMirror', () => {
    expect(pure.length).toBeGreaterThan(30)
    for (const f of pure) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/from '[^']+\.vue'/)
      expect(src, f).not.toMatch(/from '@renderer\//)
      expect(src, f).not.toMatch(/from '@codemirror\//)
      expect(src, f).not.toMatch(/from '@(shared|nb)\//)
    }
  })
  it('the domain does not depend on Vue or on the app', () => {
    for (const f of pure.filter((x) => /[\\/](domain|commands)[\\/]|[\\/](spec|model|httpText)\.ts$/.test(x))) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/from 'vue'/)
      expect(src, f).not.toMatch(/\bwindow\./)
    }
  })
})
