import { describe, expect, it } from 'vitest'
import { componentMarkdown } from '../../src/shared/browser/inspect/componentBundle'
import { decodeVlq, originalPlace, sourceAround, sourceMapUrl } from '../../src/shared/browser/inspect/sourceMap'

describe('a built script back in its source', () => {
  it('decodes VLQ segments', () => {
    expect(decodeVlq('AAAA')).toEqual([0, 0, 0, 0])
    expect(decodeVlq('AACA')).toEqual([0, 0, 1, 0])
    expect(decodeVlq('D')).toEqual([-1])
    expect(decodeVlq('gB')).toEqual([16])
  })
  // built line 0: col 0 → src 0 line 0 col 0; col 10 → line 2 col 4 (name 0); built line 1: col 2 → line 5 col 0
  const map = { version: 3, sources: ['src/Button.vue'], names: ['onClick'], sourcesContent: ['l1\nl2\nl3 onClick\nl4\nl5\nl6 next'], mappings: 'AAAA,UAEIA;EAGJ' }
  it('finds the source line for a built place (the nearest segment before it)', () => {
    expect(originalPlace(map, 0, 12)).toEqual({ source: 'src/Button.vue', line: 3, column: 4, name: 'onClick' })
    expect(originalPlace(map, 0, 3)).toMatchObject({ line: 1 })
    expect(originalPlace(map, 1, 9)).toMatchObject({ line: 6, column: 0 })
    expect(originalPlace(map, 5, 0)).toBeUndefined()
    expect(sourceAround(map, { source: 'src/Button.vue', line: 3, column: 4 }, 1, 1)).toBe('    2  l2\n    3  l3 onClick\n    4  l4')
  })
  it('resolves the map address against its script', () => {
    expect(sourceMapUrl('https://a.test/js/app.js', 'app.js.map')).toBe('https://a.test/js/app.js.map')
    expect(sourceMapUrl('https://a.test/js/app.js', undefined)).toBeUndefined()
  })
})

describe('a component as one text', () => {
  it('has what it is, its HTML, CSS and handlers — one code once, a fence the code cannot close', () => {
    const md = componentMarkdown({
      page: 'https://a.test/',
      selector: 'button.save',
      html: '<button class="save">Save</button>',
      css: '.save { color: red; }',
      info: [{ framework: 'Vue 3', name: 'SaveButton', file: 'src/SaveButton.vue', props: { label: 'Save' }, owners: ['Toolbar', 'App'] }],
      handlers: [
        { type: 'click', on: 'сам элемент', script: 'https://a.test/app.js', line: 9, code: 'e => save(`x`)', source: { file: 'src/SaveButton.vue', line: 12, code: 'function save() {}' } },
        { type: 'click', on: 'span', script: 'https://a.test/app.js', line: 9, source: { file: 'src/SaveButton.vue', line: 12 } },
      ],
      notes: ['стили из чужих доменов не прочитаны'],
    })
    expect(md).toContain('**Vue 3:** SaveButton — `src/SaveButton.vue`')
    expect(md).toContain('внутри: Toolbar ← App')
    expect(md).toContain('```html\n<button class="save">Save</button>\n```')
    expect(md).toContain('Исходник (по source map):')
    expect(md).toContain('_тот же обработчик, что выше_')
    expect(md).toContain('- стили из чужих доменов не прочитаны')
  })
})
