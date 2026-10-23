/** The colours of the page the browser shows after an OAuth sign-in (no app CSS there): the app's dark look. */
const PAGE_BG = '#11131a'
const PAGE_TEXT = '#e2e8f0'

/** The page the browser shows after a sign-in (the outcome in words; `text` is already HTML-safe). */
export function signInOutcomePage(title: string, text: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Qvarch</title><body style="font:16px system-ui;background:${PAGE_BG};color:${PAGE_TEXT};display:grid;place-items:center;height:90vh"><div><h2>${title}</h2><p>${text}</p></div>`
}
