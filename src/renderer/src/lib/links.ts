/**
 * Links of the app: a click opens the system browser, the middle button — the app's own Браузер (as a new tab
 * there). The middle button fires no `click`: on a link (an <a>, or anything marked data-link) its own click
 * handler is run with that wish set, so every place that opens a link with openUrl() follows it.
 */
let inApp = false
export function openUrl(url: string, here = inApp): void {
  if (!/^https?:\/\//i.test(url)) return
  if (here) window.qa.browserOpen(url)
  else window.qa.openExternal(url)
}

const LINK = 'a, [data-link]'
let set = false
export function setupLinks(): void {
  if (set) return
  set = true
  // no autoscroll on a link
  window.addEventListener('mousedown', (e) => e.button === 1 && (e.target as HTMLElement).closest?.(LINK) && e.preventDefault(), true)
  window.addEventListener(
    'auxclick',
    (e) => {
      if (e.button !== 1) return
      const el = (e.target as HTMLElement).closest?.(LINK) as HTMLElement | null
      if (!el) return
      e.preventDefault()
      e.stopPropagation()
      const a = el.closest('a[href]') as HTMLAnchorElement | null
      if (a && /^https?:\/\//i.test(a.getAttribute('href') ?? '')) return void window.qa.browserOpen(a.href)
      inApp = true
      try {
        el.click()
      } finally {
        inApp = false
      }
    },
    true,
  )
}
