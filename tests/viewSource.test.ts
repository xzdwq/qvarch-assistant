import { describe, expect, it } from 'vitest'
import { sourcePage } from '../src/main/viewSource'

describe('the source viewer', () => {
  it('colours the HTML once (no doubled >), links href / src to their own source, numbers the lines', async () => {
    const html = '<!doctype html>\n<a href="/x?a=1" class=b>Hi</a><img src=pic.png>\n<!-- note -->'
    const r = await sourcePage('https://site.test/page', async () => new Response(html, { headers: { 'content-type': 'text/html' } }))
    const page = await r.text()
    expect(page).toContain('<td class="n">3</td>')
    expect(page).not.toContain('&gt;&gt;')
    expect(page).toContain('href="qa-source:https://site.test/x?a=1"')
    expect(page).toContain('href="qa-source:https://site.test/pic.png"')
    expect(page).toContain('<span class="c">&lt;!-- note --&gt;</span>')
  })
})
