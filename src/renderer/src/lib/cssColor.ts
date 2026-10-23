/**
 * A colour defined in CSS (a variable of the theme / a palette) as a concrete value — for what cannot take
 * `var(--x)`: a canvas, the terminal's renderer, `<input type="color">`, a colour saved into the user's data.
 * `el` — where to read it (a variable set on an element); the document's root by default.
 */
export function cssColor(name: `--${string}`, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim()
}

/** A colour of CSS as `#rrggbb` (what `<input type="color">` and stored colours take); undefined — not one. */
export function cssHex(name: `--${string}`, el?: Element): string | undefined {
  const value = cssColor(name, el)
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map((c) => c + c).join('')}`.toLowerCase()
  const m = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value)
  return m ? `#${m.slice(1, 4).map((x) => Number(x).toString(16).padStart(2, '0')).join('')}` : undefined
}
