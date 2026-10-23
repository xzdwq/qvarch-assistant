import type { Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { AUDIO_EMBED, IMAGE_EMBED } from '@shared/vault'
import { inlineValue, resolvePath, TEMPLATE, type Values } from '@nb/domain/values'
import { envResolver, type RunEnv } from '@nb/engine'
import { codeFencesField } from './codeBlocks'
import { componentRanges } from './components/componentField'
import { editorHost, refreshDecorations } from './editorHost'

/**
 * The note's values in its text: `{{ login.status }}` drawn as the value where the line stands — the note's, or in
 * a loop the pass shown (the raw text where the cursor is; «no value» — dashed).
 */
class ValueChip extends WidgetType {
  constructor(
    readonly path: string,
    readonly shown: string,
    readonly ok: boolean,
  ) {
    super()
  }
  eq(o: ValueChip): boolean {
    return o.path === this.path && o.shown === this.shown && o.ok === this.ok
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = this.ok ? 'cm-val' : 'cm-val none'
    s.textContent = this.shown
    s.title = this.ok ? `{{ ${this.path} }}` : `{{ ${this.path} }} — нет значения: выполните блок, который его публикует`
    return s
  }
}

/**
 * The values of the lines, kept between redraws (typing, moving the cursor read nothing again): the lines' envs and
 * each env's values — let go when the text changes or the values do (refreshDecorations).
 */
class LineValues {
  envOfLine?: (line: number) => RunEnv
  readonly byEnv = new Map<RunEnv, Values>()
  constructor(readonly view: EditorView) {}
  at(line: number): Values {
    this.envOfLine ??= envResolver(this.view.state.facet(editorHost).notePath(), this.view.state.doc.toString())
    const env = this.envOfLine(line)
    let vals = this.byEnv.get(env)
    if (!vals) this.byEnv.set(env, (vals = env.values()))
    return vals
  }
}

/** The chips of the visible lines (not in code, not in components, not on a picture's / a recording's line). */
function buildValueChips(v: EditorView, values: LineValues): DecorationSet {
  const notePath = v.state.facet(editorHost).notePath()
  if (!notePath) return Decoration.none
  const s = v.state
  const out: Range<Decoration>[] = []
  const focus = v.hasFocus
  const touched = (from: number, to: number) => focus && s.selection.ranges.some((r) => r.from <= to && r.to >= from)
  const fences = s.field(codeFencesField, false) ?? []
  const comps = componentRanges(s)
  const inCodeOrComponent = (pos: number) => fences.some((b) => pos >= b.from && pos <= b.to) || comps.some((c) => pos >= c.from && pos <= c.to)
  const valuesAtLine = (line: number) => values.at(line)
  for (const { from, to } of v.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = s.doc.lineAt(pos)
      pos = line.to + 1
      if (!line.text.includes('{{') || inCodeOrComponent(line.from) || IMAGE_EMBED.test(line.text) || AUDIO_EMBED.test(line.text)) continue
      const vals = valuesAtLine(line.number)
      TEMPLATE.lastIndex = 0
      let tm: RegExpExecArray | null
      while ((tm = TEMPLATE.exec(line.text))) {
        const a = line.from + tm.index
        const b = a + tm[0].length
        if (touched(a, b)) continue
        const r = resolvePath(vals, tm[1])
        out.push(Decoration.replace({ widget: new ValueChip(tm[1], r.ok ? inlineValue(r.value) : tm[1], r.ok) }).range(a, b))
      }
    }
  }
  return Decoration.set(out, true)
}

/** The value chips, drawn again on every update (the cursor shows the raw text); their values read again only when the text or the values change. */
export const valueChips = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    values: LineValues
    constructor(v: EditorView) {
      this.values = new LineValues(v)
      this.decorations = buildValueChips(v, this.values)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refreshDecorations)))) this.values = new LineValues(u.view)
      this.decorations = buildValueChips(u.view, this.values)
    }
  },
  { decorations: (p) => p.decorations },
)
