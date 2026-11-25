import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { linkEdit, setHeading, toggleLines, toggleMark, wikiLinkEdit, type FormatEdit } from '../../src/notebook/editor/toolbar/formatEdits'

/** A text with the selection marked by `⟦` … `⟧` (or a cursor `|`), the edit applied: the text and the selection back. */
function apply(marked: string, edit: FormatEdit): string {
  const cursor = marked.indexOf('|')
  const from = cursor >= 0 ? cursor : marked.indexOf('⟦')
  const to = cursor >= 0 ? cursor : marked.indexOf('⟧') - 1
  const doc = cursor >= 0 ? marked.replace('|', '') : marked.replace('⟦', '').replace('⟧', '')
  const s = EditorState.create({ doc, selection: EditorSelection.range(from, to) })
  const spec = edit(s)
  const n = spec ? s.update(spec).state : s
  const r = n.selection.main
  const t = n.doc.toString()
  return r.empty ? `${t.slice(0, r.head)}|${t.slice(r.head)}` : `${t.slice(0, r.from)}⟦${t.slice(r.from, r.to)}⟧${t.slice(r.to)}`
}

describe('inline marks', () => {
  it('put on and taken away again (the selection kept on the text)', () => {
    expect(apply('a ⟦word⟧ b', toggleMark('bold'))).toBe('a **⟦word⟧** b')
    expect(apply('a **⟦word⟧** b', toggleMark('bold'))).toBe('a ⟦word⟧ b')
    expect(apply('a ⟦**word**⟧ b', toggleMark('bold'))).toBe('a ⟦word⟧ b')
    expect(apply('x ⟦y⟧ z', toggleMark('strike'))).toBe('x ~~⟦y⟧~~ z')
    expect(apply('x ⟦y⟧ z', toggleMark('code'))).toBe('x `⟦y⟧` z')
  })
  it('a cursor: an empty pair to type in; pressed again — gone', () => {
    expect(apply('a |b', toggleMark('bold'))).toBe('a **|**b')
    expect(apply('a **|**b', toggleMark('bold'))).toBe('a |b')
  })
  it('italic inside bold: added, not mistaken for bold’s own stars', () => {
    expect(apply('**⟦w⟧**', toggleMark('italic'))).toBe('***⟦w⟧***')
    expect(apply('***⟦w⟧***', toggleMark('italic'))).toBe('**⟦w⟧**')
    expect(apply('***⟦w⟧***', toggleMark('bold'))).toBe('*⟦w⟧*')
    expect(apply('*⟦w⟧*', toggleMark('bold'))).toBe('***⟦w⟧***')
  })
})

describe('lines', () => {
  it('a list made, another list’s sign replaced, the same again — plain text (the indent kept)', () => {
    expect(apply('⟦one\n\ntwo⟧', toggleLines('bullet'))).toBe('⟦- one\n\n- two⟧')
    expect(apply('⟦- one\n  - two⟧', toggleLines('ordered'))).toBe('⟦1. one\n  2. two⟧')
    expect(apply('⟦1. one\n2. two⟧', toggleLines('task'))).toBe('⟦- [ ] one\n- [ ] two⟧')
    expect(apply('⟦- [ ] one\n- [x] two⟧', toggleLines('task'))).toBe('⟦one\ntwo⟧')
    expect(apply('⟦- one\n- [ ] two⟧', toggleLines('bullet'))).toBe('⟦- one\n- two⟧')
  })
  it('a cursor on an empty line: the sign put there, the cursor after it', () => {
    expect(apply('a\n|\nb', toggleLines('task'))).toBe('a\n- [ ] |\nb')
    expect(apply('text|', toggleLines('quote'))).toBe('> text|')
    expect(apply('> text|', toggleLines('quote'))).toBe('text|')
  })
  it('headings: a level set (the old one replaced), the same level again — plain text', () => {
    expect(apply('Title|', setHeading(2))).toBe('## Title|')
    expect(apply('### Title|', setHeading(1))).toBe('# Title|')
    expect(apply('## Title|', setHeading(2))).toBe('Title|')
    expect(apply('## Title|', setHeading(0))).toBe('Title|')
  })
})

describe('links', () => {
  it('text — its address to write (selected); an address — its text to write', () => {
    expect(apply('see ⟦docs⟧ here', linkEdit)).toBe('see [docs](⟦https://⟧) here')
    expect(apply('⟦https://a.b/c⟧', linkEdit)).toBe('[|](https://a.b/c)')
    expect(apply('a |', wikiLinkEdit)).toBe('a [[|]]')
    expect(apply('⟦Note⟧', wikiLinkEdit)).toBe('[[Note|]]')
  })
})
