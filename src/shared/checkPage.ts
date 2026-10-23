/**
 * The watcher on a page for «Проверка»: it runs in a world of its own (the site's scripts do not see it, it
 * touches nothing of theirs) and tells the browser through a protocol binding what it sees — error toasts,
 * dialogs, spinners that do not go, text out of its table cell, a page wider than the window.
 */
import { UNSAVED_TEXT } from './check'

export const CHECK_BINDING = '__qvarchCheck'
/** The outline drawn on a foreign page (no CSS of ours there, so a literal colour). */
const HIGHLIGHT_OUTLINE = '#ef4444'
const HIGHLIGHT_DIM = 'rgba(0,0,0,.25)'
export const CHECK_WORLD = 'qvarch-check'

export type PageFinding =
  | { t: 'toast'; text: string; sel: string }
  | { t: 'dialog'; text: string; sel: string }
  | { t: 'loading'; ms: number; sel: string }
  | { t: 'overflow'; text: string; sel: string; over: number }
  | { t: 'hscroll'; over: number }

/** The script (the settings put in): an IIFE, safe to run twice (the second does nothing). */
export function checkPageScript(o: { loadingMs: number; kinds: Record<PageFinding['t'], boolean> }): string {
  return `(() => {
  if (window.__qvarchCheckOn) return
  window.__qvarchCheckOn = true
  const O = ${JSON.stringify(o)}
  const send = (x) => { try { ${CHECK_BINDING}(JSON.stringify(x)) } catch (e) {} }
  // the same thing at the same place — once a while
  const seen = new Map()
  const once = (key, ms) => { const t = seen.get(key); if (t && Date.now() - t < ms) return false; seen.set(key, Date.now()); return true }
  const visible = (el) => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 }
  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 400)
  // a CSS path to show the element again later
  const pathOf = (el) => {
    const parts = []
    for (let e = el; e && e.nodeType === 1 && parts.length < 7; e = e.parentElement) {
      if (e.id && /^[A-Za-z][\\w-]*$/.test(e.id)) { parts.unshift('#' + e.id); break }
      let p = e.tagName.toLowerCase()
      const cls = [...e.classList].filter((c) => /^[A-Za-z][\\w-]*$/.test(c) && !/active|hover|focus|selected/.test(c)).slice(0, 2)
      if (cls.length) p += '.' + cls.join('.')
      const sib = e.parentElement ? [...e.parentElement.children].filter((x) => x.tagName === e.tagName) : []
      if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')'
      parts.unshift(p)
    }
    return parts.join(' > ')
  }
  // ---------- error toasts, dialogs ----------
  const TOAST = '.q-notification, [role="alert"], .el-message--error, .el-notification, .toast-error, .Toastify__toast--error, .ant-message-error, .ant-notification-notice-error, .MuiAlert-standardError, .MuiAlert-filledError, .v-snack--error, .notification.is-danger, .alert-danger'
  const ERRWORDS = /ошибк|error|не удалось|failed|исключени|exception|недостаточно прав|forbidden|невозможно|internal/i
  const isError = (el) => {
    const c = el.className && String(el.className)
    if (/q-notification/.test(c)) return /bg-negative|text-negative|negative/.test(c) || ERRWORDS.test(textOf(el))
    if (/error|danger/i.test(c)) return true
    return ERRWORDS.test(textOf(el))
  }
  const DIALOG = '.q-dialog, [role="dialog"], [role="alertdialog"], .el-message-box, .modal.show, .ant-modal'
  const UNSAVED = ${UNSAVED_TEXT}
  const look = (root) => {
    if (!(root instanceof Element)) return
    if (O.kinds.toast) for (const el of [root, ...root.querySelectorAll(TOAST)]) {
      if (!el.matches || !el.matches(TOAST) || !isError(el)) continue
      const text = textOf(el)
      if (text && once('toast|' + text, 8000)) send({ t: 'toast', text, sel: pathOf(el) })
    }
    if (O.kinds.dialog) for (const el of [root, ...root.querySelectorAll(DIALOG)]) {
      if (!el.matches || !el.matches(DIALOG)) continue
      // its text comes a moment later (transitions)
      setTimeout(() => {
        const text = textOf(el)
        if (visible(el) && UNSAVED.test(text) && once('dialog|' + text, 5000)) send({ t: 'dialog', text, sel: pathOf(el) })
      }, 250)
    }
  }
  // (run before the page has its document — it waits for it)
  const watch = () => new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) look(n); dirty() }).observe(document.documentElement, { childList: true, subtree: true })
  // ---------- spinners that stay ----------
  const SPIN = '.q-inner-loading, .q-loading, .q-spinner, [aria-busy="true"], .el-loading-mask, .ant-spin-spinning, .MuiCircularProgress-root, .v-progress-circular, .spinner, .loader, .loading'
  const since = new WeakMap()
  if (O.kinds.loading) setInterval(() => {
    if (document.hidden) return
    for (const el of document.querySelectorAll(SPIN)) {
      if (!visible(el)) { since.delete(el); continue }
      const t0 = since.get(el)
      if (!t0) { since.set(el, Date.now()); continue }
      const ms = Date.now() - t0
      if (ms >= O.loadingMs && once('loading|' + pathOf(el), 60000)) send({ t: 'loading', ms, sel: pathOf(el) })
    }
  }, 1000)
  // ---------- text out of its cell; a page wider than the window (after the page settles) ----------
  let timer = 0
  let lastScan = 0
  function dirty() {
    if (!O.kinds.overflow && !O.kinds.hscroll) return
    clearTimeout(timer)
    timer = setTimeout(scan, Math.max(1500, 4000 - (Date.now() - lastScan)))
  }
  function scan() {
    lastScan = Date.now()
    if (document.hidden) return
    if (O.kinds.hscroll) {
      const over = document.documentElement.scrollWidth - window.innerWidth
      if (over > 4 && getComputedStyle(document.documentElement).overflowX !== 'hidden' && once('hscroll|' + location.pathname, 120000)) send({ t: 'hscroll', over })
    }
    if (!O.kinds.overflow) return
    let n = 0
    const cells = document.querySelectorAll('td, th, [role="cell"], [role="gridcell"], [role="columnheader"]')
    for (let i = 0; i < cells.length && i < 3000 && n < 5; i++) {
      const el = cells[i]
      if (el.scrollWidth <= el.clientWidth + 2 || !visible(el)) continue
      const s = getComputedStyle(el)
      // cut on purpose (an ellipsis, a scroll) — fine; only text that spills out over its neighbours
      if (s.overflowX !== 'visible' || s.textOverflow === 'ellipsis') continue
      const kids = el.querySelectorAll('*')
      let cut = false
      for (let k = 0; k < kids.length && k < 50; k++) { const ks = getComputedStyle(kids[k]); if (ks.textOverflow === 'ellipsis' || (ks.overflowX !== 'visible' && kids[k].scrollWidth > kids[k].clientWidth)) { cut = true; break } }
      if (cut) continue
      const text = textOf(el)
      const sel = pathOf(el)
      if (text && once('overflow|' + sel, 60000)) { n++; send({ t: 'overflow', text: text.slice(0, 120), sel, over: el.scrollWidth - el.clientWidth }) }
    }
  }
  const begin = () => { watch(); look(document.documentElement); dirty() }
  if (document.documentElement && document.body) begin()
  else document.addEventListener('DOMContentLoaded', begin, { once: true })
})()`
}

/** The element shown on the page for a moment (an outline around it, scrolled to). */
export function highlightScript(sel: string): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  if (!el) return false
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const r = el.getBoundingClientRect()
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid ${HIGHLIGHT_OUTLINE};border-radius:4px;box-shadow:0 0 0 4000px ${HIGHLIGHT_DIM};transition:opacity .4s'
  Object.assign(box.style, { left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' })
  document.documentElement.appendChild(box)
  setTimeout(() => (box.style.opacity = '0'), 1800)
  setTimeout(() => box.remove(), 2300)
  return true
})()`
}
