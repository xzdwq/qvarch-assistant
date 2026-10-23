/**
 * «Проверка»: the browser watches what a tester does by hand and notes what looks wrong — on the network (5xx,
 * empty ids, a form sent twice…) and on the page (an error toast, «unsaved changes» after a good save, an
 * endless spinner, text out of its cell…). The same finding again is counted, not listed again; a kind of finding
 * may be turned off or one finding muted. What the tester picks becomes a bug note in the notebook.
 */

export const CHECK_SEVS = ['high', 'mid', 'low'] as const
export type CheckSev = (typeof CHECK_SEVS)[number]

/** The kinds of findings, in the order they are shown (the most severe first). */
const CHECK_KIND_LIST = [
  { id: 'http5xx', label: 'Ошибка сервера (5xx)', sev: 'high', hint: 'Ответ 500–599 на запрос страницы' },
  { id: 'unsaved', label: '«Несохранённые изменения» после сохранения', sev: 'high', hint: 'Окно о несохранённых изменениях, хотя сохранение только что прошло (ответ 2xx)' },
  { id: 'http4xx', label: 'Отказ сервера (4xx)', sev: 'mid', hint: 'Ответ 400–499 (кроме 401 — вход)' },
  { id: 'netfail', label: 'Запрос не дошёл', sev: 'mid', hint: 'Обрыв, таймаут, CORS (отмены при переходе не считаются)' },
  { id: 'emptyId', label: 'Пустой id в запросе', sev: 'mid', hint: 'undefined / null / пустая строка вместо id — в адресе или в полях …Id тела' },
  { id: 'double', label: 'Двойная отправка', sev: 'mid', hint: 'Один и тот же POST / PUT / PATCH / DELETE дважды за 1,5 с' },
  { id: 'toast', label: 'Сообщение об ошибке', sev: 'mid', hint: 'Всплывающее сообщение об ошибке на странице' },
  { id: 'loading', label: 'Бесконечная загрузка', sev: 'mid', hint: 'Индикатор загрузки виден дольше заданного времени' },
  { id: 'console', label: 'Ошибка в консоли', sev: 'mid', hint: 'console.error и необработанные исключения страницы' },
  { id: 'slow', label: 'Медленный запрос', sev: 'low', hint: 'Ответ дольше заданного времени' },
  { id: 'nulls', label: 'Пустые поля в отправленной форме', sev: 'low', hint: 'null / "" в теле POST / PUT / PATCH — сверить с тем, что было на экране' },
  { id: 'overflow', label: 'Текст вылезает из ячейки', sev: 'low', hint: 'Содержимое ячейки таблицы шире ячейки и выходит за её край' },
  { id: 'hscroll', label: 'Горизонтальная прокрутка страницы', sev: 'low', hint: 'Страница шире окна' },
] as const satisfies ReadonlyArray<{ id: string; label: string; sev: CheckSev; hint: string }>

export type CheckKind = (typeof CHECK_KIND_LIST)[number]['id']
export interface CheckKindMeta {
  id: CheckKind
  label: string
  sev: CheckSev
  hint: string
}
export const CHECK_KINDS: readonly CheckKindMeta[] = CHECK_KIND_LIST
const KIND_META = Object.fromEntries(CHECK_KINDS.map((k) => [k.id, k])) as Record<CheckKind, CheckKindMeta>
export const kindMeta = (k: CheckKind): CheckKindMeta => KIND_META[k]

export interface CheckSettings {
  /** Watching all tabs. */
  on: boolean
  /** Kinds turned off. */
  off: CheckKind[]
  /** A request slower than this is noted, ms. */
  slowMs: number
  /** A spinner seen longer than this is noted, ms. */
  loadingMs: number
  /** Requests to other sites (counters, maps, fonts…) too — by default only the page's own site. */
  allSites: boolean
  /** Findings muted for good (their keys). */
  mutes: string[]
}
export const DEFAULT_CHECK: CheckSettings = { on: false, off: [], slowMs: 5000, loadingMs: 10000, allSites: false, mutes: [] }

export interface CheckReq {
  method: string
  url: string
  status?: number
  ms?: number
  /** What was sent — whole (the journal runs it again); none when too big (see reqBodyCut). */
  reqBody?: string
  /** The body was bigger than kept — its length; it is not kept at all (a cut JSON would not run). */
  reqBodyCut?: number
  resBody?: string
  contentType?: string
}
export interface CheckProblem {
  id: string
  kind: CheckKind
  sev: CheckSev
  /** One line: what and where. */
  title: string
  /** More: the error's text, the empty fields, the requests still waiting… */
  detail?: string
  /** The page it happened on. */
  page: string
  tabId: string
  /** First and last time. */
  at: number
  last: number
  /** How many times. */
  count: number
  /** The same finding again has this key (it is also what «Не показывать такие» mutes). */
  key: string
  /** The request it is about. */
  req?: CheckReq
  /** The element on the page (a CSS path) — shown by «Показать на странице». */
  selector?: string
  /** The bug note it went into. */
  note?: string
}
export interface CheckState {
  settings: CheckSettings
  /** Tabs where the watching could not start (the page's DevTools hold the protocol). */
  blocked: string[]
}

// ---------- requests ----------
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
/** A request's shape: its host and path with the ids as :id, its query's keys (no values) — the same endpoint, whatever the ids. */
export function normUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname
      .replace(UUID, ':id')
      .split('/')
      .map((s) => (/^\d+$/.test(s) || /^[0-9a-f]{16,}$/i.test(s) ? ':id' : s))
      .join('/')
    const keys = [...new Set([...u.searchParams.keys()])].sort()
    return `${u.host}${path}${keys.length ? `?${keys.join('&')}` : ''}`
  } catch {
    return url
  }
}
/** The same site: the hosts' last two names agree (app.example.com and api.example.com). */
export function sameSite(a: string, b: string): boolean {
  try {
    const tail = (h: string) => h.split('.').slice(-2).join('.')
    const ha = new URL(a).hostname
    const hb = new URL(b).hostname
    return ha === hb || tail(ha) === tail(hb)
  } catch {
    return false
  }
}
export const isMutation = (method: string) => /^(POST|PUT|PATCH|DELETE)$/i.test(method)

/** A JS value printed where an id should be. */
const NOT_AN_ID = /^(undefined|null|NaN|\[object Object\])$/
/** The values of a body's …Id field that hold no id. */
const EMPTY_BODY_IDS: ReadonlySet<unknown> = new Set(['', 'undefined', 'null'])

/** An id that is not one in the address: …/undefined, ?id=null, ?productId=, a double slash. */
export function badUrlId(url: string): string | undefined {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  const seg = u.pathname.split('/').find((s) => NOT_AN_ID.test(decodeURIComponent(s)))
  if (seg) return `в адресе «${decodeURIComponent(seg)}»`
  if (/[^:]\/\//.test(u.pathname)) return 'в адресе пустой сегмент (//)'
  for (const [k, v] of u.searchParams) {
    if (NOT_AN_ID.test(v)) return `параметр ${k}=${v}`
    if (/id$/i.test(k) && v === '') return `параметр ${k} пустой`
  }
  return undefined
}

/** The fields of a JSON body: path → value (arrays by index); at most `max`. */
function walk(v: unknown, path: string, out: Array<[string, unknown]>, max: number): void {
  if (out.length >= max) return
  if (v && typeof v === 'object') {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, out, max))
    else for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, out, max)
  } else out.push([path, v])
}
const parseJson = (s?: string): unknown => {
  if (!s || !/^\s*[[{]/.test(s)) return undefined
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}
/** The …Id fields of a body that hold no id: "", "undefined", "null". */
export function badBodyIds(body?: string): string[] {
  const j = parseJson(body)
  if (j === undefined) return []
  const all: Array<[string, unknown]> = []
  walk(j, '', all, 5000)
  return all
    .filter(([p, v]) => /(^|\.|\])(ids?|\w+Ids?|\w+_ids?)(\[\d+\])?$/.test(p) && EMPTY_BODY_IDS.has(v))
    .map(([p, v]) => `${p} = ${JSON.stringify(v)}`)
    .slice(0, 20)
}
/** The fields of a sent form that are empty (null, "") — the ids are told apart (badBodyIds). */
export function emptyFields(body?: string): string[] {
  const j = parseJson(body)
  if (j === undefined) return []
  const all: Array<[string, unknown]> = []
  walk(j, '', all, 5000)
  const ids = new Set(badBodyIds(body).map((x) => x.split(' = ')[0]))
  return all
    .filter(([p, v]) => (v === null || v === '') && !ids.has(p))
    .map(([p]) => p)
    .slice(0, 30)
}

/** A request's body as kept: whole up to 2 MB, else none (its length said) — never cut in the middle. */
export const REQ_BODY_MAX = 2_000_000
export const keepBody = (s?: string): Pick<CheckReq, 'reqBody' | 'reqBodyCut'> => (s === undefined ? {} : s.length > REQ_BODY_MAX ? { reqBodyCut: s.length } : { reqBody: s })
/** A short line for a request: «POST /api/nest/compounds/add/:id → 500». */
export function reqLine(r: CheckReq): string {
  let path = r.url
  try {
    const u = new URL(r.url)
    path = u.pathname.replace(UUID, ':id')
  } catch {
    // as is
  }
  return `${r.method} ${path}${r.status !== undefined ? ` → ${r.status}` : ''}`
}

/** The recorder's key when it writes a bug's steps (not a note's block). */
export const CHECK_STEPS = 'check:steps'

/** The words of the «unsaved changes» dialogs. */
export const UNSAVED_TEXT = /несохран|не сохран|изменения (будут )?(потеря|утеря)|покинуть страницу|unsaved|discard changes|leave (this )?page/i
