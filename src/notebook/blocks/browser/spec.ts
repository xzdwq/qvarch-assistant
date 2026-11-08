import type { BlockSpec } from '../../domain/blockSpec'

/** The height a browser block asks for (`height:` in its body; default 560). */
const browserHeightOf = (src: string) => Number(/height:\s*(\d+)/.exec(src)?.[1]) || 560

/** Live pages in tabs right in the note (```browser, any attributes: name=…; a new one — browser1: `browser` is Playwright's own). */
export const browserSpec: BlockSpec<'browser'> = {
  kind: 'browser',
  title: 'Браузер',
  detect: { by: 'fence', matches: (h) => h.lang === 'browser' },
  estimateHeight: (src) => 128 + browserHeightOf(src),
  rawEditable: true,
  commands: [
    {
      id: 'browser',
      title: 'Браузер',
      hint: 'Живые страницы во вкладках прямо в заметке; запросы и время загрузки',
      icon: 'browser',
      keys: ['браузер', 'browser', 'сайт', 'страница', 'web', 'вкладка', 'запросы', 'network', 'iframe'],
      run: (c) => ({ kind: 'insertBlock', markdown: `\`\`\`browser name=${c.freeName('browser', true)}\nurl: about:blank\nheight: 560\n\`\`\`` }),
    },
  ],
}
