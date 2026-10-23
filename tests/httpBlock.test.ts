import { describe, expect, it } from 'vitest'
import { httpBlocks, httpRequestText, namesIn, requestName } from '../src/shared/httpBlock'
import { parseHttpText } from '../src/shared/runbook'

describe('a request of the site as a block of the notebook', () => {
  it('the query a parameter a line, the body laid out, its type, the login', () => {
    const t = httpRequestText({ method: 'post', url: 'https://app.example.com/api/items/search?page=2&q=red%20car&ids[]=1', body: '{"filter":{"ids":[1,2]}}' }, [
      ['Authorization', 'Bearer t-1'],
      ['Cookie', 'sid=abc'],
    ])
    expect(t).toBe(
      [
        'POST https://app.example.com/api/items/search',
        '    ?page=2',
        '    &ids[]=1',
        '    &q=red%20car',
        'Content-Type: application/json',
        'Authorization: Bearer t-1',
        'Cookie: sid=abc',
        '',
        '{',
        '  "filter": {',
        '    "ids": [',
        '      1,',
        '      2',
        '    ]',
        '  }',
        '}',
      ]
        .join('\n')
        .replace('    ?page=2\n    &ids[]=1\n    &q=red%20car', '    ?page=2\n    &q=red%20car\n    &ids[]=1'),
    )
  })
  it('read back as it was sent: the same address (the query joined), headers, body', () => {
    const url = 'https://app.example.com/api/items?page=2&q=a%26b&empty='
    const p = parseHttpText(httpRequestText({ method: 'GET', url }, [['X-CSRF-Token', 'k']]))
    expect(new URL(p.url).searchParams.get('q')).toBe('a&b')
    expect(new URL(p.url).searchParams.get('empty')).toBe('')
    expect(new URL(p.url).searchParams.get('page')).toBe('2')
    expect(p.headers).toEqual([['X-CSRF-Token', 'k']])
    expect(p.body).toBe('')
  })
  it("the note's {{ values }} in the address kept whole (a path parameter, a query value)", () => {
    const t = httpRequestText({ method: 'GET', url: 'https://x.test/api/items/{{id}}/rows?limit=10&owner={{user.id}}' })
    expect(t).toBe('GET https://x.test/api/items/{{id}}/rows\n    ?limit=10\n    &owner={{user.id}}')
  })
  it("a description's own headers kept; the login over them", () => {
    const t = httpRequestText({ method: 'GET', url: 'https://x.test/a', headers: [['X-Tenant', 't1'], ['Authorization', '{{token}}']] }, [['Authorization', 'Bearer real']])
    expect(t).toBe('GET https://x.test/a\nX-Tenant: t1\nAuthorization: Bearer real')
  })
  it('names: the method and the last word, free in the note', () => {
    const taken = namesIn('```http name=get_items\nGET https://x\n```')
    expect(requestName('GET', 'https://x/api/items', taken)).toBe('get_items_2')
    expect(requestName('POST', 'https://x/api/items/12/save-draft', taken)).toBe('post_save_draft')
    expect(requestName('GET', 'https://x/', taken)).toBe('get_request')
  })
  it('several as blocks: fenced, named, a fence longer than one in a body', () => {
    const out = httpBlocks([{ method: 'GET', url: 'https://x/a' }, { method: 'POST', url: 'https://x/a', body: 'text with ``` inside' }], () => [])
    expect(out).toMatch(/^```http name=get_a\nGET https:\/\/x\/a\n```\n\n````http name=post_a\n/)
  })
})
