import { describe, expect, it } from 'vitest'
import { chatMarkdown } from '../../src/shared/transport/chatText'

const members = [
  { id: 'me', name: 'Анна' },
  { id: 'b', name: 'Борис' },
]

describe('a message as Markdown', () => {
  it('mentions lit (one’s own apart), links made the app’s, Markdown left as it is', () => {
    const r = chatMarkdown('**Итог**: @Борис, см. [[План#Сроки]] и @Анна', members, 'me')
    expect(r.md).toBe('**Итог**: <span class="mention">@Борис</span>, см. <a data-chat-link="0">План</a> и <span class="mention me">@Анна</span>')
    expect(r.links[0]).toMatchObject({ kind: 'note', target: 'План', section: 'Сроки' })
  })
  it('a tag written in a message is its text: shown, and what follows it kept', () => {
    const r = chatMarkdown('3. спецсимволы и XSS (<script>alert(1)</script>)\n4. дальше', members, 'me')
    expect(r.md).toBe('3. спецсимволы и XSS (&lt;script>alert(1)&lt;/script>)\n4. дальше')
    // (a quote of Markdown stays one)
    expect(chatMarkdown('> цитата', members, 'me').md).toBe('> цитата')
  })
  it('code stays as written: no mention, no link inside it', () => {
    const r = chatMarkdown('`@Борис [[X]]` и\n```\nselect * from city -- @Анна\n```', members, 'me')
    expect(r.md).toBe('`@Борис [[X]]` и\n```\nselect * from city -- @Анна\n```')
    expect(r.links).toEqual([])
  })
  it('a name with signs HTML would take — escaped', () => {
    expect(chatMarkdown('@<b>', [{ id: 'x', name: '<b>' }], 'me').md).toBe('<span class="mention">@&lt;b&gt;</span>')
  })
})
