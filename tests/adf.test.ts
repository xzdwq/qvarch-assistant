import { describe, expect, it } from 'vitest'
import { adfToMarkdown } from '../src/shared/adf'

const doc = (...content: unknown[]) => ({ type: 'doc', version: 1, content })
const p = (...content: unknown[]) => ({ type: 'paragraph', content })
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) })

describe('adfToMarkdown', () => {
  it('paragraphs, marks and links', () => {
    expect(adfToMarkdown(doc(p(t('Нужно '), t('срочно', [{ type: 'strong' }]), t(' см. '), t('тут', [{ type: 'link', attrs: { href: 'https://x.y' } }]))))).toBe(
      'Нужно **срочно** см. [тут](https://x.y)',
    )
  })
  it('every mark, nested in order; unknown marks and links without href leave the text', () => {
    const marks = [{ type: 'strong' }, { type: 'em' }, { type: 'code' }, { type: 'strike' }]
    expect(adfToMarkdown(doc(p(t('x', marks))))).toBe('~~`***x***`~~')
    expect(adfToMarkdown(doc(p(t('y', [{ type: 'underline' }, { type: 'link' }, { type: 'constructor' }]))))).toBe('y')
  })
  it('quotes and panels', () => {
    expect(adfToMarkdown(doc({ type: 'panel', content: [p(t('a')), p(t('b'))] }))).toBe('> a\n> \n> b')
    expect(adfToMarkdown(doc({ type: 'blockquote', content: [p(t('q'))] }))).toBe('> q')
  })
  it('lists, headings, code', () => {
    const md = adfToMarkdown(
      doc(
        { type: 'heading', attrs: { level: 3 }, content: [t('Шаги')] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('один'))] }, { type: 'listItem', content: [p(t('два'))] }] },
        { type: 'codeBlock', attrs: { language: 'sql' }, content: [t('select 1')] },
      ),
    )
    expect(md).toBe('### Шаги\n\n- один\n- два\n\n```sql\nselect 1\n```')
  })
  it('cuts long text and survives junk', () => {
    expect(adfToMarkdown(doc(p(t('a'.repeat(50)))), 10)).toBe('aaaaaaaaaa…')
    expect(adfToMarkdown(undefined)).toBe('')
    expect(adfToMarkdown({ type: 'doc', content: [{ type: 'mediaSingle', content: [] }] })).toBe('')
  })
})
