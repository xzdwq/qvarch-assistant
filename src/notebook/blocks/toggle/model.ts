/** The fold component's model: `<details>` with a `<summary>` title and Markdown inside. */
export interface ToggleModel {
  title: string
  body: string
  open: boolean
}
export const TOGGLE_OPEN = /^<details(\s+open)?\s*>\s*$/i
export const TOGGLE_CLOSE = /^<\/details>\s*$/i
export function parseToggle(src: string): ToggleModel {
  const lines = src.split('\n')
  const open = /open/i.test(lines[0])
  const inner = lines.slice(1, -1).join('\n')
  const m = /^\s*<summary>([\s\S]*?)<\/summary>\s*\n?([\s\S]*)$/i.exec(inner)
  return { open, title: (m?.[1] ?? '').trim(), body: (m ? m[2] : inner).replace(/^\n+|\n+$/g, '') }
}
export const toggleMd = (t: ToggleModel) => `<details${t.open ? ' open' : ''}>\n<summary>${t.title.replace(/<\/?summary>/gi, '')}</summary>\n\n${t.body}\n\n</details>`
