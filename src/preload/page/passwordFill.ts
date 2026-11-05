/// <reference lib="dom" />
import type { PageLogin } from '../../shared/browser/pageChannels'
import { askMain, onMain, sendMain } from '../pageIpc'

/**
 * A browser page's sign-in forms. A login sent (a form submitted, Enter in it, its button clicked) goes to the app —
 * it offers to keep it; a page with a password field gets its site's saved login typed in. The page itself cannot
 * reach this (isolated), and the app answers only for the page's own address.
 */

/** A password field shows up this long after the page changed (a single-page app draws its form late). */
const LOOK_DELAY_MS = 400
/** A single-page app keeps changing — looking for a sign-in form stops after this. */
const WATCH_MS = 60_000

const visible = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
const passwords = (root: ParentNode = document) => [...root.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(visible)
/** The login field of a password: the nearest text / e-mail field before it (in its form, else on the page). */
function loginFor(pw: HTMLInputElement): HTMLInputElement | undefined {
  const scope: ParentNode = pw.form ?? document
  let best: HTMLInputElement | undefined
  for (const i of scope.querySelectorAll<HTMLInputElement>('input')) {
    if (i === pw) break
    if (/^(text|email|tel|)$/i.test(i.type) && visible(i)) best = i
  }
  return best
}
function send(pw: HTMLInputElement | undefined): void {
  if (!pw?.value) return
  sendMain('pwSubmit', { username: loginFor(pw)?.value ?? '', password: pw.value })
}
const filledPw = () => passwords().find((p) => p.value)
document.addEventListener('submit', (e) => send(passwords(e.target as HTMLFormElement).find((p) => p.value)), true)
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Enter') return
    const t = e.target as HTMLInputElement
    if (t.tagName === 'INPUT' && (t.type === 'password' || (filledPw() && /^(text|email|tel)$/i.test(t.type)))) send(filledPw())
  },
  true,
)
document.addEventListener(
  'click',
  (e) => {
    const b = (e.target as HTMLElement).closest?.('button, input[type="submit"], [role="button"], a')
    if (b) send(filledPw())
  },
  true,
)

/** A value typed as a person would: the page's own handlers (React, Vue) see it. */
function put(el: HTMLInputElement, v: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  set?.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
function fill(c: PageLogin, force = false): void {
  const pw = passwords()[0]
  if (!pw) return
  if (force || !pw.value) put(pw, c.password)
  const login = loginFor(pw)
  if (login && c.username && (force || !login.value)) put(login, c.username)
}
// the site's saved login into its form — once per page, when a password field shows up (also later, in an app)
let asked = false
let timer: ReturnType<typeof setTimeout> | undefined
function look(): void {
  timer = undefined
  if (asked || !passwords().length) return
  asked = true
  void askMain('pwGet').then((c) => c && fill(c))
}
const schedule = () => (timer ??= setTimeout(look, LOOK_DELAY_MS))
window.addEventListener('DOMContentLoaded', () => {
  schedule()
  const mo = new MutationObserver(schedule)
  mo.observe(document.documentElement, { childList: true, subtree: true })
  setTimeout(() => mo.disconnect(), WATCH_MS)
})
// «Подставить» from the app's passwords list
onMain('pwFill', (c) => fill(c, true))
