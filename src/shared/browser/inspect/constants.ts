/**
 * The inspector's value sets and limits: what opens a group of the log, how long a group gathers, how much is kept —
 * all bounded, so a busy site never grows the app's memory or slows the window.
 */

/** What opens a group of the log: a person's act on the page, a page opened, a route of a single-page app, the page by itself. */
export const ACTION_KINDS = ['click', 'input', 'submit', 'key', 'scroll', 'nav', 'route', 'background'] as const
export type ActionKind = (typeof ACTION_KINDS)[number]
/** How each is told in the log. */
export const ACTION_WORDS: Record<ActionKind, string> = {
  click: 'Клик',
  input: 'Ввод',
  submit: 'Отправка формы',
  key: 'Клавиша',
  scroll: 'Прокрутка',
  nav: 'Открытие страницы',
  route: 'Переход в приложении',
  background: 'Сама страница',
}

/** A group gathers until the page is quiet this long (no request going, nothing new), ms. */
export const QUIET_MS = 600
/** …and at most this long after its act (a page that polls never keeps one open), ms. */
export const MAX_GROUP_MS = 15_000
/** Typing in one field: its keys within this gap are one group, ms. */
export const INPUT_MERGE_MS = 1500
/** The log keeps this many groups per tab (the oldest go). */
export const MAX_GROUPS = 200
/** A group keeps this many requests / console lines (the rest counted only). */
export const MAX_GROUP_REQS = 400
export const MAX_GROUP_NOTES = 100
/** The window is told of a tab's changed groups at most this often, ms. */
export const EMIT_MS = 300

/** Console lines the log keeps: errors and warnings (the rest of a site's console is its own business). */
export const NOTE_LEVELS = ['error', 'warning'] as const
export type NoteLevel = (typeof NOTE_LEVELS)[number]

/**
 * A request's source as the log colours it — the order is the colours' order (a stacked bar keeps it; the palette
 * is checked for colour-blind separation in this order): the document, scripts, API calls, pictures, styles, fonts,
 * media, sockets, the rest.
 */
export const REQ_CATS = ['doc', 'js', 'api', 'img', 'css', 'font', 'media', 'ws', 'other'] as const
export type ReqCat = (typeof REQ_CATS)[number]
/** Each source's short label (on its badge — the colour is never the only sign) and its name. */
export const REQ_CAT_WORDS: Record<ReqCat, { short: string; name: string }> = {
  doc: { short: 'DOC', name: 'Документы' },
  js: { short: 'JS', name: 'Скрипты' },
  api: { short: 'API', name: 'Запросы API (fetch / xhr)' },
  img: { short: 'IMG', name: 'Картинки' },
  css: { short: 'CSS', name: 'Стили' },
  font: { short: 'FONT', name: 'Шрифты' },
  media: { short: 'MEDIA', name: 'Аудио и видео' },
  ws: { short: 'WS', name: 'WebSocket / SSE' },
  other: { short: '…', name: 'Прочее' },
}
/** The protocol's resource type → its source. */
const CAT_OF: Record<string, ReqCat> = { Document: 'doc', Script: 'js', XHR: 'api', Fetch: 'api', Preflight: 'api', Image: 'img', Stylesheet: 'css', Font: 'font', Media: 'media', WebSocket: 'ws', EventSource: 'ws' }
export const reqCat = (type: string): ReqCat => CAT_OF[type] ?? 'other'

/**
 * What made the main thread work, as Long Animation Frames tell it (a script's invoker type) — the timeline's
 * colours in this order: an event's handler, a promise, a callback (timer, frame), a script loading, the rest.
 */
export const TASK_KINDS = ['event', 'promise', 'callback', 'script', 'other'] as const
export type TaskKind = (typeof TASK_KINDS)[number]
export const TASK_WORDS: Record<TaskKind, string> = { event: 'Обработчик события', promise: 'Промис', callback: 'Колбэк (таймер / кадр)', script: 'Загрузка скрипта', other: 'Прочее' }
const TASK_OF: Record<string, TaskKind> = { 'event-listener': 'event', 'resolve-promise': 'promise', 'reject-promise': 'promise', 'user-callback': 'callback', 'classic-script': 'script', 'module-script': 'script' }
export const taskKind = (invokerType: string): TaskKind => TASK_OF[invokerType] ?? 'other'

/**
 * What an animation costs the browser by the properties it changes: the compositor alone (transform, opacity —
 * cheap), painting again, laying the page out again (the dearest) — told with a word, never by colour alone.
 */
export const ANIM_COSTS = ['composite', 'paint', 'layout'] as const
export type AnimCost = (typeof ANIM_COSTS)[number]
export const ANIM_COST_WORDS: Record<AnimCost, string> = { composite: 'композитор (дёшево)', paint: 'перерисовка', layout: 'раскладка (дорого)' }
/** The properties whose change lays the page out again / paints it again (the rest of the common ones — the compositor's). */
export const LAYOUT_PROPS = /^(width|height|min-|max-|top|left|right|bottom|inset|margin|padding|border(-\w+)?-width|font-size|line-height|letter-spacing|flex|grid|gap|display|position)/
export const PAINT_PROPS = /^(color|background|border(-\w+)?-(color|style|radius)|border-radius|box-shadow|outline|text-shadow|text-decoration|fill|stroke|visibility|clip-path|mask)/

/** A scroll is the person's when it starts this soon after their wheel / touch / key / pointer, ms. */
export const SCROLL_INPUT_MS = 1000
/** A scroll ends after this long without moving, ms. */
export const SCROLL_END_MS = 300
/** The scroll's frames: one longer than this is a stutter, ms. */
export const SLOW_FRAME_MS = 50

/** The page's performance sampled this often while the inspector is on (as DevTools' «Performance monitor»), ms; this many kept. */
export const MONITOR_MS = 1000
export const MONITOR_KEEP = 180

/** The resource kinds as the protocol names them (Network.ResourceType) — those a group shows by their own word. */
export const REQ_WORDS: Record<string, string> = {
  Document: 'документ',
  XHR: 'xhr',
  Fetch: 'fetch',
  Script: 'скрипт',
  Stylesheet: 'стили',
  Image: 'картинка',
  Font: 'шрифт',
  Media: 'медиа',
  WebSocket: 'websocket',
  EventSource: 'sse',
  Manifest: 'manifest',
  Ping: 'ping',
  Preflight: 'preflight',
  Other: 'другое',
}

/** Web Vitals: the metric's «good» and «poor» bounds (web.dev), in its unit (ms; CLS — a score). */
export const VITALS = {
  LCP: { good: 2500, poor: 4000, unit: 'ms', title: 'Отрисовка главного (LCP)' },
  FCP: { good: 1800, poor: 3000, unit: 'ms', title: 'Первая отрисовка (FCP)' },
  CLS: { good: 0.1, poor: 0.25, unit: '', title: 'Сдвиги вёрстки (CLS)' },
  INP: { good: 200, poor: 500, unit: 'ms', title: 'Отклик на действие (INP)' },
  TTFB: { good: 800, poor: 1800, unit: 'ms', title: 'Ответ сервера (TTFB)' },
} as const
export type VitalName = keyof typeof VITALS
export const VITAL_RATINGS = ['good', 'mid', 'poor'] as const
export type VitalRating = (typeof VITAL_RATINGS)[number]
/** A metric's value rated by its bounds. */
export function rateVital(name: VitalName, v: number): VitalRating {
  const b = VITALS[name]
  return v <= b.good ? 'good' : v <= b.poor ? 'mid' : 'poor'
}

/** How bad a finding about the site is. */
export const PROBLEM_LEVELS = ['high', 'mid', 'info'] as const
export type ProblemLevel = (typeof PROBLEM_LEVELS)[number]

/** What the page's context menu copies about an element (the menu's order; `-` — a separator before it). */
export const COPY_KINDS = ['html', 'text', 'css', 'computed', 'component', 'selector', 'xpath', 'jspath', 'locator', 'shot'] as const
export type CopyKind = (typeof COPY_KINDS)[number]
export const COPY_WORDS: Record<CopyKind, string> = {
  html: 'HTML элемента',
  text: 'Текст',
  css: 'CSS (правила сайта)',
  computed: 'Вычисленные стили',
  component: 'Компонент целиком (HTML + CSS + JS)',
  selector: 'CSS-селектор',
  xpath: 'XPath',
  jspath: 'JS-путь (document.querySelector)',
  locator: 'Локатор Playwright',
  shot: 'Снимок элемента (картинка)',
}
/** The copies a separator goes before in the menu. */
export const COPY_GROUP_STARTS: readonly CopyKind[] = ['css', 'selector', 'shot']

/** The isolated world the inspector's page script lives in, and its way to main (Runtime.addBinding). */
export const INSPECT_WORLD = 'qvarch-inspect'
export const INSPECT_BINDING = '__qvarchInspect'
