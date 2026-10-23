import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  badBodyIds,
  badUrlId,
  DEFAULT_CHECK,
  emptyFields,
  isMutation,
  keepBody,
  kindMeta,
  normUrl,
  reqLine,
  sameSite,
  type CheckKind,
  type CheckProblem,
  type CheckReq,
  type CheckSettings,
} from '../shared/check'
import type { PageFinding } from '../shared/checkPage'
import type { ApiMapStore } from './apiMap'

const MAX = 500
const BODY = 20000
/** A request of a watched tab, from its start to its end. */
export interface Flight {
  method: string
  url: string
  type: string
  start: number
  postData?: string
  hasPostData?: boolean
  status?: number
  mime?: string
  reqType?: string
  /** The request's headers, the answer's (for the map). */
  reqHeaders?: Record<string, string>
  resHeaders?: Record<string, string>
}
interface Done {
  method: string
  url: string
  body?: string
  at: number
  status: number
  /** A mutation that went through (2xx). */
  ok: boolean
  req: CheckReq
}

/**
 * The findings of «Проверка» and what they are judged by: each tab's requests on the way and the last ones
 * done (a form sent twice, «unsaved changes» after a good save, an error toast after a failed request).
 * Kept on disk (data/check.json): a restart loses nothing.
 */
export class CheckWatch {
  settings: CheckSettings
  private list: CheckProblem[]
  private flights = new Map<string, Map<string, Flight>>()
  private recent = new Map<string, Done[]>()
  private saveTimer?: ReturnType<typeof setTimeout>
  private seq = 0

  constructor(
    private root: string,
    private emit: () => void,
    /** «Карта API»: every request of the page's own site goes into it too. */
    private map?: ApiMapStore,
  ) {
    const saved = this.read<{ settings?: Partial<CheckSettings>; list?: CheckProblem[] }>()
    this.settings = { ...DEFAULT_CHECK, ...(saved?.settings ?? {}) }
    this.list = Array.isArray(saved?.list) ? saved.list : []
  }
  private read<T>(): T | undefined {
    const f = join(this.root, 'check.json')
    if (!existsSync(f)) return undefined
    try {
      return JSON.parse(readFileSync(f, 'utf8')) as T
    } catch {
      return undefined
    }
  }
  private save(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      // over 30 MB of bodies kept: the oldest findings (beyond the newest 100) lose theirs — their length stays
      let total = this.list.reduce((n, p) => n + (p.req?.reqBody?.length ?? 0), 0)
      for (let i = this.list.length - 1; i >= 100 && total > 30_000_000; i--) {
        const r = this.list[i].req
        if (!r?.reqBody) continue
        total -= r.reqBody.length
        r.reqBodyCut = r.reqBody.length
        r.reqBody = undefined
      }
      writeAtomic(join(this.root, 'check.json'), JSON.stringify({ settings: this.settings, list: this.list }))
    }, 400)
  }
  private changed(): void {
    this.save()
    this.emit()
  }

  problems(): CheckProblem[] {
    return this.list
  }
  setSettings(p: Partial<CheckSettings>): CheckSettings {
    this.settings = { ...this.settings, ...p }
    this.changed()
    return this.settings
  }
  clear(ids?: string[]): void {
    this.list = ids ? this.list.filter((x) => !ids.includes(x.id)) : []
    this.changed()
  }
  mute(key: string, on = true): void {
    const m = new Set(this.settings.mutes)
    if (on) m.add(key)
    else m.delete(key)
    this.settings = { ...this.settings, mutes: [...m] }
    this.list = on ? this.list.filter((x) => x.key !== key) : this.list
    this.changed()
  }
  /** The findings that went into a bug note. */
  setNote(ids: string[], note: string): void {
    for (const p of this.list) if (ids.includes(p.id)) p.note = note
    this.changed()
  }
  dropTab(tabId: string): void {
    this.flights.delete(tabId)
    this.recent.delete(tabId)
  }
  private on(k: CheckKind): boolean {
    return this.settings.on && !this.settings.off.includes(k)
  }
  /** A finding: a new one, or the same one again (counted). */
  private add(k: CheckKind, tabId: string, page: string, key: string, title: string, extra: Partial<CheckProblem> = {}): void {
    if (!this.on(k)) return
    const full = `${k}|${key}`
    if (this.settings.mutes.includes(full)) return
    const now = Date.now()
    const same = this.list.find((x) => x.key === full && !x.note)
    if (same) {
      same.count++
      same.last = now
      // the newest request is the one to look at
      if (extra.req) same.req = extra.req
      if (extra.detail) same.detail = extra.detail
      same.page = page
    } else {
      this.list.unshift({ id: `${now.toString(36)}${(++this.seq).toString(36)}`, kind: k, sev: kindMeta(k).sev, title, page, tabId, at: now, last: now, count: 1, key: full, ...extra })
      if (this.list.length > MAX) this.list.length = MAX
    }
    this.changed()
  }

  // ---------- the network (the protocol's events of a watched tab) ----------
  /** The page's own requests only (unless all sites are watched). */
  private mine(page: string, url: string): boolean {
    return /^https?:/i.test(url) && (this.settings.allSites || sameSite(page, url))
  }
  started(tabId: string, page: string, id: string, f: Flight): void {
    if (!/^(XHR|Fetch|Document)$/.test(f.type) || !this.mine(page || f.url, f.url)) return
    let m = this.flights.get(tabId)
    if (!m) this.flights.set(tabId, (m = new Map()))
    if (m.size > 2000) m.clear()
    m.set(id, f)
    // (the page's own address — its route, not a request to the API)
    const bad = f.type === 'Document' ? undefined : badUrlId(f.url)
    if (bad) this.add('emptyId', tabId, page, `${normUrl(f.url)}|${bad}`, `Пустой id: ${reqLine({ method: f.method, url: f.url })}`, { detail: bad, req: { method: f.method, url: f.url, ...keepBody(f.postData) } })
  }
  answered(tabId: string, id: string, status: number, mime?: string, resHeaders?: Record<string, string>): void {
    const f = this.flights.get(tabId)?.get(id)
    if (f) Object.assign(f, { status, mime, resHeaders })
  }
  /** Done: judged when its bodies are known (`bodies` asks the protocol for them, as needed). */
  async finished(tabId: string, page: string, id: string, failed: string | undefined, bodies: (needPost: boolean, needRes: boolean) => Promise<{ post?: string; res?: string }>): Promise<void> {
    const m = this.flights.get(tabId)
    const f = m?.get(id)
    if (!f) return
    m!.delete(id)
    const ms = Date.now() - f.start
    if (failed) {
      // a page left / a request cancelled — not a fault
      if (/ERR_ABORTED|canceled|cancelled/i.test(failed)) return
      if (f.type !== 'Document') this.map?.add({ method: f.method, url: f.url, page, status: 0, ms, at: f.start, reqBody: f.postData, contentType: f.reqType, reqHeaders: f.reqHeaders })
      return this.add('netfail', tabId, page, normUrl(f.url), `Запрос не дошёл: ${reqLine(f)} (${failed})`, { detail: failed, req: { method: f.method, url: f.url, ms, ...keepBody(f.postData) } })
    }
    const status = f.status ?? 0
    const mut = isMutation(f.method)
    const bad5 = status >= 500
    const bad4 = status >= 400 && status < 500 && status !== 401
    const slow = ms >= this.settings.slowMs
    const textual = /json|text|xml|javascript|html|problem/i.test(f.mime ?? '')
    const forMap = !!this.map && f.type !== 'Document'
    const needRes = textual && ((bad5 || bad4) || (forMap && this.map!.wants(f.method, f.url, status, f.postData)))
    const needPost = !!f.hasPostData && f.postData === undefined
    const b = needRes || needPost ? await bodies(needPost, needRes).catch(() => ({}) as { post?: string; res?: string }) : {}
    const post = f.postData ?? b.post
    const req: CheckReq = { method: f.method, url: f.url, status, ms, ...keepBody(post), resBody: b.res?.slice(0, BODY), contentType: f.reqType }
    const nu = normUrl(f.url)
    if (forMap) this.map!.add({ method: f.method, url: f.url, page, status, ms, at: f.start, reqBody: post, resBody: b.res, contentType: f.reqType, reqHeaders: f.reqHeaders, resHeaders: f.resHeaders })
    // a spinner found waiting for this very request: it answered now — how long it took in the end, and with what
    for (const p of this.list)
      if (p.kind === 'loading' && p.tabId === tabId && !p.note && p.req && p.req.status === undefined && p.req.method === f.method && p.req.url === f.url) {
        p.req = { ...req, ...(req.reqBody === undefined && !req.reqBodyCut ? { reqBody: p.req.reqBody, reqBodyCut: p.req.reqBodyCut } : {}) }
        p.detail = `${p.detail ?? ''}\nОтвет пришёл через ${(ms / 1000).toFixed(1)} с: ${status}`.trim()
        this.changed()
      }
    if (bad5) this.add('http5xx', tabId, page, `${f.method} ${nu}|${status}`, reqLine(req), { req, detail: errText(b.res) })
    else if (bad4) this.add('http4xx', tabId, page, `${f.method} ${nu}|${status}`, reqLine(req), { req, detail: errText(b.res) })
    if (slow) this.add('slow', tabId, page, `${f.method} ${nu}`, `Медленно: ${reqLine(req)} — ${(ms / 1000).toFixed(1)} с`, { req })
    if (mut && post) {
      const ids = badBodyIds(post)
      if (ids.length) this.add('emptyId', tabId, page, `${f.method} ${nu}|body`, `Пустой id в теле: ${reqLine(req)}`, { req, detail: ids.join('\n') })
      const empty = emptyFields(post)
      if (empty.length && f.method !== 'DELETE') this.add('nulls', tabId, page, `${f.method} ${nu}`, `Пустые поля (${empty.length}) в ${reqLine({ method: f.method, url: f.url })}`, { req, detail: `Пустые (null / ""): ${empty.join(', ')}\nСверьте с тем, что было заполнено на экране.` })
    }
    if (mut) {
      const list = this.recent.get(tabId) ?? []
      // the same request with the same body a moment ago — sent twice
      const twin = list.find((d) => d.method === f.method && d.url === f.url && (d.body ?? '') === (post ?? '') && f.start - d.at < 1500)
      if (twin) this.add('double', tabId, page, `${f.method} ${nu}`, `Двойная отправка: ${reqLine(req)}`, { req, detail: `Тот же запрос с тем же телом дважды за ${Math.max(1, f.start - twin.at)} мс` })
      list.push({ method: f.method, url: f.url, body: post, at: f.start, status, ok: status >= 200 && status < 300, req })
      while (list.length > 30) list.shift()
      this.recent.set(tabId, list)
    }
  }
  /** The requests of a tab still on the way (for an endless spinner). */
  /** The requests a tab still waits for, the longest first (a spinner that stays — what it waits for). */
  private waiting(tabId: string): Flight[] {
    const now = Date.now()
    return [...(this.flights.get(tabId)?.values() ?? [])].filter((f) => f.type !== 'Document' && now - f.start > 1000).sort((a, b) => a.start - b.start)
  }

  // ---------- the page (the watcher in it; the console) ----------
  page(tabId: string, page: string, x: PageFinding): void {
    const path = pathOf(page)
    if (x.t === 'toast') {
      // the request that failed just before, if any
      const last = [...(this.recent.get(tabId) ?? [])].reverse().find((d) => d.status >= 400 && Date.now() - d.at < 10000)
      this.add('toast', tabId, page, `${path}|${x.text.slice(0, 80)}`, `Сообщение об ошибке: «${x.text.slice(0, 120)}»`, { detail: x.text, selector: x.sel, req: last?.req })
    } else if (x.t === 'dialog') {
      const list = this.recent.get(tabId) ?? []
      const okAt = [...list].reverse().find((d) => d.ok)
      const failAfter = okAt && list.some((d) => !d.ok && d.at > okAt.at)
      if (okAt && !failAfter && Date.now() - okAt.at < 120000)
        this.add('unsaved', tabId, page, `${path}`, `«Несохранённые изменения» после успешного сохранения`, {
          detail: `Окно: «${x.text.slice(0, 200)}»\nПеред этим сохранение прошло: ${reqLine(okAt.req)} (${Math.round((Date.now() - okAt.at) / 1000)} с назад)`,
          selector: x.sel,
          req: okAt.req,
        })
    } else if (x.t === 'loading') {
      // one finding per request waited for (several spinners of one wait — one finding), the request itself shown
      const w = this.waiting(tabId)
      const now = Date.now()
      const main = w[0]
      const secs = Math.round(x.ms / 1000)
      const detail = w.length
        ? `Индикатор загрузки виден ${secs} с. Страница ждёт ответа:\n${w.slice(0, 10).map((f) => `${reqLine(f)} — уже ${Math.round((now - f.start) / 1000)} с`).join('\n')}`
        : `Индикатор загрузки виден ${secs} с, но запросов в ожидании нет — загрузка не связана с сетью (зависло на странице).`
      this.add('loading', tabId, page, `${path}|${main ? `${main.method} ${normUrl(main.url)}` : 'без сети'}`, main ? `Загрузка дольше ${secs} с: ждём ${reqLine(main)}` : `Загрузка дольше ${secs} с без запросов в сети`, {
        detail,
        selector: x.sel,
        req: main ? { method: main.method, url: main.url, ...keepBody(main.postData), contentType: main.reqType } : undefined,
      })
    }
    else if (x.t === 'overflow') this.add('overflow', tabId, page, `${path}|${x.sel}`, `Текст вылезает из ячейки: «${x.text.slice(0, 60)}»`, { detail: `Шире ячейки на ${x.over}px: «${x.text}»`, selector: x.sel })
    else if (x.t === 'hscroll') this.add('hscroll', tabId, page, path, `Горизонтальная прокрутка: страница шире окна на ${x.over}px`)
  }
  console(tabId: string, page: string, text: string, where?: string): void {
    const t = text.replace(/\s+/g, ' ').trim()
    if (!t) return
    this.add('console', tabId, page, `${pathOf(page)}|${t.slice(0, 100)}`, `Консоль: ${t.slice(0, 140)}`, { detail: where ? `${t}\n${where}` : t })
  }
}

function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data, 'utf8')
  renameSync(tmp, file)
}
const pathOf = (u: string) => {
  try {
    const x = new URL(u)
    return `${x.host}${x.pathname}`
  } catch {
    return u
  }
}
/** An answer's error text: the message of a JSON error, else the start of the text. */
function errText(res?: string): string | undefined {
  if (!res) return undefined
  try {
    const j = JSON.parse(res) as Record<string, unknown>
    const m = j.message ?? j.error ?? j.title ?? j.detail
    if (m) return typeof m === 'string' ? m : JSON.stringify(m)
  } catch {
    // text
  }
  return res.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || undefined
}
