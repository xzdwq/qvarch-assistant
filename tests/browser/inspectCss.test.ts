import { describe, expect, it } from 'vitest'
import { computedCss, cssOfElements, type CdpMatched, type CdpProp, type CdpRule } from '../../src/shared/browser/inspect/cssBundle'

let line = 0
const p = (name: string, value: string, extra: Partial<CdpProp> = {}): CdpProp => ({ name, value, text: `${name}: ${value}`, range: { startLine: line, startColumn: 0 }, ...extra })
const rule = (sel: string, props: CdpProp[], extra: Partial<CdpRule> = {}): { rule: CdpRule } => ({ rule: { styleSheetId: 's1', selectorList: { text: sel }, origin: 'regular', style: { cssProperties: props, range: { startLine: ++line, startColumn: 0 } }, ...extra } })

describe('an element CSS as the site wrote it', () => {
  it('keeps the winning declarations of the site rules only: the browser own left out, the overridden dropped', () => {
    const m: CdpMatched = {
      matchedCSSRules: [
        { rule: { selectorList: { text: 'button' }, origin: 'user-agent', style: { cssProperties: [p('cursor', 'default')] } } },
        rule('.btn', [p('color', 'red'), p('padding', '4px', { longhandProperties: [{ name: 'padding-top', value: '4px' }, { name: 'padding-left', value: '4px' }] }), p('color', 'red', { implicit: true, text: undefined, range: undefined })]),
        rule('.btn.primary', [p('color', 'blue'), p('margin', '0')]),
      ],
    }
    const css = cssOfElements([m], 'button.btn')
    expect(css).not.toContain('cursor')
    expect(css).toContain('.btn {\n  padding: 4px;\n}')
    expect(css).toContain('.btn.primary {\n  color: blue;\n  margin: 0;\n}')
    expect(css).not.toContain('color: red')
  })
  it('an !important beats a later plain one; the inline style counts and is written for the root', () => {
    const m: CdpMatched = {
      matchedCSSRules: [rule('.a', [p('color', 'red', { important: true })]), rule('.b', [p('color', 'blue'), p('width', '10px')])],
      inlineStyle: { cssProperties: [p('width', '20px')] },
    }
    const css = cssOfElements([m], '#x')
    expect(css).toContain('.a {\n  color: red !important;\n}')
    expect(css).not.toContain('width: 10px')
    expect(css).toContain('/* style="" элемента */\n#x {\n  width: 20px;\n}')
  })
  it('keeps the at-rules, the variables used (an ancestor one, a variable of a variable), the keyframes, the inherited text styles', () => {
    const m: CdpMatched = {
      matchedCSSRules: [rule('.card', [p('background', 'var(--bg)'), p('animation', 'fade 1s')], { media: [{ text: '(min-width: 600px)' }] })],
      inherited: [{ matchedCSSRules: [rule(':root', [p('--bg', 'var(--base)'), p('--base', '#fff'), p('--unused', '1')]), rule('body', [p('font-family', 'Inter'), p('color', '#111')])] }],
      cssKeyframesRules: [{ animationName: { text: 'fade' }, keyframes: [{ keyText: { text: 'from' }, style: { cssProperties: [p('opacity', '0')] } }] }],
    }
    const css = cssOfElements([m], '.card')
    expect(css).toContain('@media (min-width: 600px) {\n  .card {\n    background: var(--bg);')
    expect(css).toContain('--bg: var(--base);')
    expect(css).toContain('--base: #fff;')
    expect(css).not.toContain('--unused')
    expect(css).toContain('@keyframes fade')
    expect(css).toContain('color: #111;')
    expect(css).toContain('font-family: Inter;')
  })
  it('a component: each rule once for all its elements', () => {
    const shared = rule('.item', [p('color', 'red')])
    const css = cssOfElements([{ matchedCSSRules: [rule('.list', [p('display', 'flex')])] }, { matchedCSSRules: [shared] }, { matchedCSSRules: [shared] }], '.list')
    expect(css.match(/\.item \{/g)).toHaveLength(1)
  })
  it('a computed style keeps the look, not the initial values nor the browser own prefixes', () => {
    const css = computedCss([{ name: 'display', value: 'flex' }, { name: 'opacity', value: '1' }, { name: '-webkit-locale', value: 'auto' }, { name: '--x', value: '1' }, { name: 'color', value: 'rgb(0, 0, 0)' }, { name: 'speak', value: 'normal' }], 'div')
    expect(css).toBe('div {\n  display: flex;\n  color: rgb(0, 0, 0);\n}')
  })
})
