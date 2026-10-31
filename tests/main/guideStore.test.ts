import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { GuideStore } from '../../src/main/agent/guideStore'
import { BUILTIN_GUIDES } from '../../src/shared/agent/harness/builtinGuides'

describe('the harness instructions kept in the database', () => {
  it('the app set at the start; an edited built-in one stays the person\'s; a deleted one is not back; reset brings the app text', () => {
    const db = new DatabaseSync(':memory:')
    const store = new GuideStore(db)
    expect(store.list().map((g) => g.id)).toEqual(BUILTIN_GUIDES.map((b) => b.id))
    const first = store.list()[0]
    store.save({ ...first, body: 'мой текст' })
    expect(store.list()[0]).toMatchObject({ body: 'мой текст', edited: true, origin: 'builtin' })
    // (a restart: the person's text stands)
    expect(new GuideStore(db).list()[0].body).toBe('мой текст')
    store.remove(BUILTIN_GUIDES[1].id)
    expect(new GuideStore(db).list().some((g) => g.id === BUILTIN_GUIDES[1].id)).toBe(false)
    store.reset(first.id)
    expect(store.list()[0]).toMatchObject({ body: BUILTIN_GUIDES[0].body, edited: false })
    store.save({ id: 'my-own', title: 'Своя', summary: 'для своего', body: 'текст', enabled: true })
    expect(store.list().at(-1)).toMatchObject({ id: 'my-own', origin: 'user' })
    expect(() => store.save({ id: 'my-own', title: 'Своя', summary: '', body: 'текст' })).toThrow(/описание/)
    db.close()
  })
})
