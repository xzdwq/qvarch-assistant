/** The SVG icons the editor's widgets draw themselves (widgets are plain DOM, not Vue). */
const svg = (paths: string, size = 15) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

export const ICON_CAPTIONS = svg('<rect width="18" height="14" x="3" y="5" rx="2" ry="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>')
export const ICON_TRASH = svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 14)
export const ICON_COPY = svg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', 15)
export const ICON_CHECK = svg('<path d="M20 6 9 17l-5-5"/>', 15)
export const ICON_MIC = svg('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>', 14)
export const ICON_EXPAND = svg('<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>', 14)
export const ICON_COMMENT = svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>', 12)
export const ICON_FORMAT =svg('<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>', 15)

/**
 * A small icon button of a widget: it never takes the editor's focus; a click runs its action (`isolate` — the click
 * goes no further up the page).
 */
export function widgetButton(icon: string, title: string, onClick: (b: HTMLButtonElement) => void, opts: { className?: string; isolate?: boolean } = {}): HTMLButtonElement {
  const b = document.createElement('button')
  if (opts.className) b.className = opts.className
  b.innerHTML = icon
  b.title = title
  b.onmousedown = (e) => e.preventDefault()
  b.onclick = (e) => {
    e.preventDefault()
    if (opts.isolate) e.stopPropagation()
    onClick(b)
  }
  return b
}
