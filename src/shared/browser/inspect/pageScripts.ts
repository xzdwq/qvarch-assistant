import { INSPECT_BINDING, SCROLL_END_MS, SCROLL_INPUT_MS, SLOW_FRAME_MS } from './constants'
import type { ProbePlan } from './techEngine'

/**
 * The inspector's code that runs in the site's page (plain JS text — it goes over the protocol). Light by design:
 * listeners on the window only, the browser's own performance observers, hover told only when the element under
 * the pointer changes (once a frame at most); the passport's probe yields to the page between pieces.
 */

/** An element in words (its button's text, a field's label) and a CSS path to it — shared by the scripts below. */
const DESCRIBE = `
  const SMALL = (s, n) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, n)
  const actable = (el) => el && el.closest ? (el.closest('a,button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],input,select,textarea,label,summary,[onclick],[tabindex]') || el) : el
  const labelOf = (el) => {
    if (!el || el.nodeType !== 1) return ''
    const aria = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt')
    if (aria) return SMALL(aria, 60)
    if (el.labels && el.labels[0]) return SMALL(el.labels[0].innerText, 60)
    const t = SMALL(el.innerText || el.value || '', 60)
    if (t) return t
    const name = el.getAttribute('name') || el.id
    return name ? el.tagName.toLowerCase() + ' ' + name : el.tagName.toLowerCase()
  }
  const pathOf = (el) => {
    const parts = []
    for (let e = el; e && e.nodeType === 1 && parts.length < 8; e = e.parentElement) {
      if (e.id && /^[A-Za-z][\\w-]*$/.test(e.id) && document.querySelectorAll('#' + e.id).length === 1) { parts.unshift('#' + e.id); break }
      let p = e.tagName.toLowerCase()
      const cls = [...e.classList].filter((c) => /^[A-Za-z_][\\w-]*$/.test(c) && c.length < 40 && !/active|hover|focus|selected|open/.test(c)).slice(0, 2)
      if (cls.length) p += '.' + cls.join('.')
      const sib = e.parentElement ? [...e.parentElement.children].filter((x) => x.tagName === e.tagName) : []
      if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')'
      parts.unshift(p)
    }
    return parts.join(' > ')
  }
`

/**
 * The person's scrolls (one that starts soon after their wheel / touch / key / pointer): while it goes, its frames
 * are counted (the smoothness, the stutters) and the scrolled content's elements put in / taken out (a virtual list
 * swaps them, an endless one adds); told as an act when it starts and its numbers when it ends.
 * The animations and transitions: each told when it starts (its properties — what it costs) and when it ends, a few
 * at a time.
 */
const SCROLL_AND_ANIMATIONS = `
  let lastInput = 0, sess = null
  for (const k of ['wheel', 'touchstart', 'keydown', 'pointerdown']) addEventListener(k, () => { lastInput = performance.now() }, { capture: true, passive: true })
  const posOf = (el) => [el.scrollLeft || 0, el.scrollTop || 0]
  const scrollEnd = () => {
    const s = sess; sess = null
    if (!s) return
    s.mo.disconnect()
    const [x, y] = posOf(s.el)
    const dx = x - s.p0[0], dy = y - s.p0[1]
    const ms = Math.max(1, Math.round(s.last - s.t0))
    send({ t: 'scroll', at: s.at, info: { target: s.path, distance: Math.round(Math.abs(dy) || Math.abs(dx)), dir: Math.abs(dy) >= Math.abs(dx) ? (dy >= 0 ? 'down' : 'up') : 'side', ms, fps: Math.round((s.frames * 1000) / Math.max(ms, 1)), slow: s.slow, maxFrame: Math.round(s.maxFrame), added: s.added, removed: s.removed } })
  }
  addEventListener('scroll', (e) => {
    const now = performance.now()
    if (!sess) {
      if (now - lastInput > ${SCROLL_INPUT_MS}) return
      const el = e.target === document || e.target === document.documentElement || e.target === document.body ? document.scrollingElement || document.documentElement : e.target
      if (!el || el.nodeType !== 1) return
      const s = { el, path: pathOf(el), at: Date.now(), t0: now, last: now, p0: posOf(el), frames: 0, slow: 0, maxFrame: 0, prev: 0, added: 0, removed: 0, timer: 0, mo: null }
      s.mo = new MutationObserver((list) => { for (const m of list) { for (const n of m.addedNodes) if (n.nodeType === 1) s.added++; for (const n of m.removedNodes) if (n.nodeType === 1) s.removed++ } })
      s.mo.observe(el === document.scrollingElement || el === document.documentElement ? document.body : el, { childList: true, subtree: true })
      const frame = (t) => { if (sess !== s) return; if (s.prev) { const d = t - s.prev; s.frames++; if (d > ${SLOW_FRAME_MS}) s.slow++; if (d > s.maxFrame) s.maxFrame = d } s.prev = t; requestAnimationFrame(frame) }
      requestAnimationFrame(frame)
      sess = s
      send({ t: 'act', kind: 'scroll', label: el === document.scrollingElement || el === document.documentElement ? 'страница' : labelOf(el), target: s.path, at: s.at })
    }
    sess.last = now
    clearTimeout(sess.timer)
    sess.timer = setTimeout(scrollEnd, ${SCROLL_END_MS})
  }, { capture: true, passive: true })
  // ---------- animations and transitions ----------
  let animSeq = 0, starts = [], ends = [], flush = 0
  const ids = new WeakMap()
  const keyOf = (e) => (e.animationName || e.propertyName || '') + '|' + (e.pseudoElement || '')
  const push = () => { if (!flush) flush = setTimeout(() => { flush = 0; if (starts.length || ends.length) send({ t: 'anim', starts: starts.splice(0, 100), ends: ends.splice(0, 200) }); starts = []; ends = [] }, 250) }
  const propsOf = (e) => {
    if (e.propertyName) return [e.propertyName]
    try { const a = e.target.getAnimations().find((x) => x.animationName === e.animationName); const kf = a && a.effect ? a.effect.getKeyframes() : []; return [...new Set(kf.flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)).map((k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())))] } catch (err) { return [] }
  }
  const animStart = (kind) => (e) => {
    if (!(e.target instanceof Element)) return
    let m = ids.get(e.target); if (!m) ids.set(e.target, (m = new Map()))
    const k = keyOf(e); if (m.has(k)) return
    const id = 'a' + (++animSeq); m.set(k, id)
    const infinite = kind === 'animation' && getComputedStyle(e.target).animationIterationCount.split(',').some((v) => v.trim() === 'infinite')
    starts.push({ id, kind, name: e.animationName || e.propertyName, target: pathOf(e.target), props: propsOf(e), at: Date.now(), infinite })
    push()
  }
  const animEnd = (e) => { const m = e.target instanceof Element && ids.get(e.target); const k = keyOf(e); const id = m && m.get(k); if (!id) return; m.delete(k); ends.push({ id, at: Date.now() }); push() }
  addEventListener('animationstart', animStart('animation'), true)
  addEventListener('transitionrun', animStart('transition'), true)
  for (const k of ['animationend', 'animationcancel', 'transitionend', 'transitioncancel']) addEventListener(k, animEnd, true)
`

/**
 * The watcher (the inspector's own world, every frame of the tab): the person's acts and scrolls, the page's busy
 * time (what started each script), its animations, its vitals (the frame and card over the element are the page
 * preload's — src/preload/page/inspector.ts).
 */
export function inspectWatchScript(): string {
  return `(() => {
  if (window.__qvarchInspectOn) return
  window.__qvarchInspectOn = true
  const top = window === window.top
  const send = (x) => { try { ${INSPECT_BINDING}(JSON.stringify(x)) } catch (e) {} }
  ${DESCRIBE}
  const wall = (t) => Math.round(performance.timeOrigin + t)
  // ---------- the person's acts ----------
  const act = (kind, el, extra) => { const a = actable(el); send({ t: 'act', kind, label: labelOf(a), target: pathOf(a), at: Date.now(), ...(extra || {}) }) }
  addEventListener('click', (e) => e.isTrusted && act('click', e.target), true)
  addEventListener('input', (e) => e.isTrusted && act('input', e.target), true)
  addEventListener('change', (e) => e.isTrusted && e.target && e.target.tagName === 'SELECT' && act('input', e.target), true)
  addEventListener('submit', (e) => act('submit', e.target), true)
  addEventListener('keydown', (e) => { if (e.isTrusted && (e.key === 'Enter' || e.key === 'Escape') && !(e.target && e.target.tagName === 'TEXTAREA')) { const a = actable(e.target); send({ t: 'act', kind: 'key', label: e.key + ' · ' + labelOf(a), target: pathOf(a), at: Date.now() }) } }, true)
  if (!top) return
  ${SCROLL_AND_ANIMATIONS}
  if (!window.PerformanceObserver) return
  const watch = (type, fn, o) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...(o || {}) }) } catch (e) {} }
  // ---------- the main thread busy (long animation frames; the old long tasks where there are none) ----------
  const loaf = PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')
  if (loaf) watch('long-animation-frame', (e) => e.duration >= 50 && send({ t: 'busy', at: wall(e.startTime), ms: Math.round(e.duration), items: (e.scripts || []).filter((s) => s.duration >= 5).slice(0, 8).map((s) => ({ type: s.invokerType || '', name: String(s.invoker || '').slice(0, 200), fn: String(s.sourceFunctionName || '').slice(0, 120), src: String(s.sourceURL || '').slice(0, 300), at: wall(s.startTime), ms: Math.round(s.duration) })) }))
  else watch('longtask', (e) => send({ t: 'busy', at: wall(e.startTime), ms: Math.round(e.duration) }))
  // ---------- vitals: told at most once a second ----------
  const vitals = {}
  let vt = 0
  const vital = (name, value, target) => { vitals[name] = { name, value, ...(target ? { target } : {}) }; if (!vt) vt = setTimeout(() => { vt = 0; send({ t: 'vitals', list: Object.values(vitals) }) }, 1000) }
  watch('largest-contentful-paint', (e) => vital('LCP', Math.round(e.startTime), e.element ? pathOf(e.element) : undefined))
  watch('paint', (e) => e.name === 'first-contentful-paint' && vital('FCP', Math.round(e.startTime)))
  let cls = 0
  watch('layout-shift', (e) => { if (e.hadRecentInput) return; cls += e.value; vital('CLS', Math.round(cls * 1000) / 1000, e.sources && e.sources[0] && e.sources[0].node && e.sources[0].node.nodeType === 1 ? pathOf(e.sources[0].node) : undefined); send({ t: 'shift', at: wall(e.startTime), value: e.value }) })
  const nav = performance.getEntriesByType('navigation')[0]
  if (nav) vital('TTFB', Math.round(nav.responseStart))
  // ---------- an act's response (Event Timing): the slowest of each interaction ----------
  let worst = 0
  watch('event', (e) => {
    if (!e.interactionId) return
    const r = { total: Math.round(e.duration), delay: Math.round(e.processingStart - e.startTime), processing: Math.round(e.processingEnd - e.processingStart), presentation: Math.max(0, Math.round(e.startTime + e.duration - e.processingEnd)) }
    send({ t: 'resp', at: wall(e.startTime), ...r })
    if (e.duration > worst) { worst = e.duration; vital('INP', Math.round(e.duration), e.target && e.target.nodeType === 1 ? pathOf(e.target) : undefined) }
  }, { durationThreshold: 16 })
})()`
}

/**
 * The passport's probe (the page's own world — the site's globals are there): the globals and selectors the
 * fingerprints ask for, <meta>, the scripts' addresses, the page's text, the frameworks' render marks, the counts.
 * Yields to the page every few hundred selectors.
 */
export function inspectProbeExpression(plan: ProbePlan): string {
  return `(async () => {
  const plan = ${JSON.stringify(plan)}
  const yieldNow = () => new Promise((r) => setTimeout(r, 0))
  const js = {}
  for (const chain of plan.js) {
    try {
      let v = window
      for (const k of chain.split('.')) { if (v == null) break; v = v[k] }
      if (v === undefined || v === null) continue
      js[chain] = typeof v === 'object' || typeof v === 'function' ? '' : String(v).slice(0, 200)
    } catch (e) {}
  }
  const dom = {}
  let n = 0
  for (const q of plan.dom) {
    if (++n % 300 === 0) await yieldNow()
    let el = null
    try { el = document.querySelector(q.s) } catch (e) { continue }
    if (!el) continue
    const o = {}
    if (q.t) o.text = (el.textContent || '').slice(0, 500)
    if (q.a) { o.attributes = {}; for (const a of q.a) { const v = el.getAttribute(a); if (v !== null) o.attributes[a] = v } }
    if (q.p) { o.properties = {}; for (const p of q.p) { try { const v = el[p]; if (v !== undefined) o.properties[p] = typeof v === 'object' || typeof v === 'function' ? '' : String(v) } catch (e) {} } }
    dom[q.s] = o
  }
  const meta = {}
  for (const m of document.querySelectorAll('meta[name],meta[property]')) { const k = m.getAttribute('name') || m.getAttribute('property'); (meta[k] = meta[k] || []).push(m.getAttribute('content') || '') }
  const scriptSrc = [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 300)
  const text = (document.body ? document.body.innerText : '') || ''
  const nd = window.__NEXT_DATA__
  const has = (s) => { try { return !!document.querySelector(s) } catch (e) { return false } }
  const rootEl = document.querySelector('#root,#app,#__next,[data-reactroot]') || (document.body && document.body.firstElementChild)
  const marks = {
    nextData: !!nd, nextStatic: !!(nd && (nd.nextExport || nd.autoExport)), nextSsr: !!(nd && nd.gssp), nextApp: !!self.__next_f,
    nuxt: !!(window.__NUXT__ || has('#__NUXT_DATA__')), nuxtPrerendered: !!(window.__NUXT__ && window.__NUXT__.prerenderedAt),
    vueSsr: has('[data-server-rendered]'), vueApp: has('[data-v-app]') || !!window.__VUE__,
    angularHydration: has('[ngh]'), angularServer: has('[ng-server-context]'),
    sveltekit: Object.keys(window).some((k) => k.startsWith('__sveltekit')), remix: !!(window.__remixContext || window.__reactRouterContext),
    gatsby: has('#___gatsby'), astroIsland: has('astro-island'), qwik: has('[q\\\\:container]'),
    reactRoot: !!rootEl && Object.keys(rootEl).some((k) => k.startsWith('__reactContainer') || k === '_reactRootContainer' || k.startsWith('__reactFiber')),
  }
  const navEntry = performance.getEntriesByType('navigation')[0]
  const paint = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')
  return {
    nav: navEntry ? navEntry.toJSON() : null, fcp: paint ? paint.startTime : undefined,
    js, dom, meta, scriptSrc, text: text.slice(0, 100000), textLen: text.replace(/\\s+/g, ' ').trim().length,
    marks: Object.keys(marks).filter((k) => marks[k]),
    manifest: has('link[rel=manifest]'), worker: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    counts: {
      nodes: document.getElementsByTagName('*').length,
      blockingScripts: document.querySelectorAll('head script[src]:not([async]):not([defer]):not([type=module])').length,
      imgNoSize: [...document.images].filter((i) => !i.getAttribute('width') && !i.getAttribute('height')).length,
      imgNoAlt: document.querySelectorAll('img:not([alt])').length,
      frames: document.querySelectorAll('iframe').length,
    },
  }
})()`
}

/** A unique CSS path to `this` element (callFunctionOn). */
export const SELECTOR_FUNCTION = `function () { ${DESCRIBE} return pathOf(this) }`
/** `this` element in words, for a handler's «on» (callFunctionOn). */
export const LABEL_FUNCTION = `function () { ${DESCRIBE} return this.nodeType === 1 ? this.tagName.toLowerCase() + (this.id ? '#' + this.id : '') + (this.classList && this.classList.length ? '.' + [...this.classList].slice(0, 2).join('.') : '') : String(this.nodeName || '?') }`

/**
 * What the frameworks say of `this` element's component (callFunctionOn, the page's world): one adapter per
 * framework — React (fiber), Vue 3 / 2, Angular (dev mode), Svelte (dev), Preact, custom elements. Production
 * builds keep few names — what is there is told.
 */
export const FRAMEWORK_FUNCTION = `function () {
  const el = this
  const out = []
  const short = (v) => { try { if (v === null || v === undefined) return String(v); if (typeof v === 'function') return 'ƒ ' + (v.name || ''); if (typeof v === 'object') { const s = JSON.stringify(v); return s && s.length > 200 ? s.slice(0, 200) + '…' : String(s) } return String(v).slice(0, 200) } catch (e) { return '[?]' } }
  const propsOf = (p) => { const o = {}; if (!p || typeof p !== 'object') return o; for (const k of Object.keys(p).slice(0, 30)) if (k !== 'children') o[k] = short(p[k]); return o }
  const nameOfType = (t) => !t ? '' : typeof t === 'string' ? t : t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && nameOfType(t.type)) || ''
  // React
  for (let e = el; e && out.length === 0; e = e.parentElement) {
    const key = Object.keys(e).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
    if (!key) continue
    let f = e[key]
    const owners = []
    let comp = null
    for (let x = f; x; x = x.return) { if (typeof x.type === 'function' || (x.type && typeof x.type === 'object')) { const n = nameOfType(x.type); if (!n) continue; if (!comp) comp = x; else if (owners.length < 6) owners.push(n) } }
    if (comp) { const src = comp._debugSource; out.push({ framework: 'React', name: nameOfType(comp.type), ...(src ? { file: src.fileName, line: src.lineNumber } : {}), props: propsOf(comp.memoizedProps), owners }) }
  }
  // Vue 3
  for (let e = el; e && !out.some((o) => o.framework.startsWith('Vue')); e = e.parentElement) {
    const i = e.__vueParentComponent
    if (!i) continue
    const owners = []
    for (let p = i.parent; p && owners.length < 6; p = p.parent) { const n = p.type && (p.type.name || p.type.__name); if (n) owners.push(n) }
    out.push({ framework: 'Vue 3', name: i.type && (i.type.name || i.type.__name), file: i.type && i.type.__file, props: propsOf(i.props), owners })
  }
  // Vue 2
  for (let e = el; e && !out.some((o) => o.framework.startsWith('Vue')); e = e.parentElement) {
    const v = e.__vue__
    if (!v) continue
    const owners = []
    for (let p = v.$parent; p && owners.length < 6; p = p.$parent) if (p.$options && p.$options.name) owners.push(p.$options.name)
    out.push({ framework: 'Vue 2', name: v.$options && (v.$options.name || v.$options._componentTag), file: v.$options && v.$options.__file, props: propsOf(v.$props), owners })
  }
  // Angular (dev mode exposes ng)
  try { const ng = window.ng; const c = ng && (ng.getComponent(el) || ng.getOwningComponent(el)); if (c) out.push({ framework: 'Angular', name: c.constructor && c.constructor.name, props: propsOf(c) }) } catch (e) {}
  // Svelte (dev)
  for (let e = el; e; e = e.parentElement) { const m = e.__svelte_meta; if (m && m.loc) { out.push({ framework: 'Svelte', name: (m.loc.file || '').split('/').pop(), file: m.loc.file, line: m.loc.line }); break } }
  // Preact
  for (let e = el; e && !out.some((o) => o.framework === 'Preact'); e = e.parentElement) { const v = e.__k || e._prevVNode; if (!v) continue; let x = v; while (x && typeof x.type !== 'function') x = x.__ || x._parent; if (x) out.push({ framework: 'Preact', name: nameOfType(x.type), props: propsOf(x.props) }) }
  // custom elements (Lit, Stencil, plain)
  for (let e = el; e; e = e.parentElement || (e.getRootNode && e.getRootNode().host)) { if (e.tagName && e.tagName.includes('-') && customElements.get(e.tagName.toLowerCase())) { const C = customElements.get(e.tagName.toLowerCase()); out.push({ framework: 'Web Component', name: e.tagName.toLowerCase() + (C.name ? ' (' + C.name + ')' : '') }); break } }
  return out.filter((o) => o.name || o.file)
}`
