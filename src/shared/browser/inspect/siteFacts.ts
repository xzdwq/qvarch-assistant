import { rateVital, VITALS, type ProblemLevel } from './constants'
import type { InspectReq, SiteFact, SiteProblem, VitalValue } from './types'

/**
 * The site's facts and problems from what its page loaded: the document's answer (protocol, server, CDN,
 * compression, cache, security headers), the resources (weight by kind, third parties, failures, mixed content),
 * the cookies, the page itself (DOM, memory, scripts that block drawing), the Web Vitals.
 */

export interface SiteCookie {
  name: string
  value: string
  domain: string
  secure: boolean
  httpOnly: boolean
  sameSite?: string
  session: boolean
}
/** What the page's probe counted on it. */
export interface PageCounts {
  nodes: number
  /** <script src> in <head> without async / defer / module. */
  blockingScripts: number
  imgNoSize: number
  imgNoAlt: number
  /** Its iframes. */
  frames: number
}
export interface SiteInput {
  url: string
  doc?: InspectReq
  reqs: InspectReq[]
  cookies: SiteCookie[]
  page?: PageCounts
  /** Performance.getMetrics: JSHeapUsedSize, JSEventListeners… */
  metrics: Record<string, number>
  vitals: VitalValue[]
  /** Console errors since the page opened. */
  errors: number
}

/** Who serves a site by its answer's headers (a CDN / a host). */
const CDNS: Array<{ name: string; is: (h: Record<string, string>) => boolean }> = [
  { name: 'Cloudflare', is: (h) => 'cf-ray' in h },
  { name: 'Fastly', is: (h) => /fastly/i.test(h['x-served-by'] ?? '') || 'x-fastly-request-id' in h },
  { name: 'Akamai', is: (h) => 'x-akamai-transformed' in h || /akamai/i.test(h.server ?? '') },
  { name: 'Amazon CloudFront', is: (h) => 'x-amz-cf-id' in h },
  { name: 'Vercel', is: (h) => 'x-vercel-id' in h },
  { name: 'Netlify', is: (h) => 'x-nf-request-id' in h },
  { name: 'Google Cloud', is: (h) => /gws|gfe|google/i.test(h.server ?? '') || 'x-goog-generation' in h },
  { name: 'Azure', is: (h) => 'x-azure-ref' in h || 'x-msedge-ref' in h },
  { name: 'Яндекс', is: (h) => /yandex/i.test(h.server ?? '') },
  { name: 'Ngenix', is: (h) => /ngenix/i.test(h.server ?? '') },
]
const KIND_OF: Record<string, string> = { Script: 'JS', Stylesheet: 'CSS', Image: 'Картинки', Font: 'Шрифты', XHR: 'API', Fetch: 'API', Document: 'HTML', Media: 'Медиа' }
const TEXTUAL = /javascript|css|json|html|xml|svg|text\//i

export const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`)
const lower = (o: Record<string, string> = {}) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]))
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname
  } catch {
    return ''
  }
}
/** The answer came from a cache on the way (a CDN's HIT, Age > 0). */
export function cacheHit(headers: Record<string, string> = {}): boolean {
  const h = lower(headers)
  return /hit/i.test(`${h['x-cache'] ?? ''} ${h['cf-cache-status'] ?? ''} ${h['x-vercel-cache'] ?? ''}`) || Number(h.age ?? 0) > 0
}
/** A host's site (its last two labels: shop.example.com → example.com). */
const siteOf = (host: string) => host.split('.').slice(-2).join('.')

/** The facts about the site and what is wrong with it. */
export function siteFacts(s: SiteInput): { facts: SiteFact[]; problems: SiteProblem[] } {
  const facts: SiteFact[] = []
  const problems: SiteProblem[] = []
  const fact = (group: string, label: string, value: string, level?: ProblemLevel) => facts.push({ group, label, value, ...(level ? { level } : {}) })
  const problem = (level: ProblemLevel, title: string, detail?: string) => problems.push({ level, title, ...(detail ? { detail } : {}) })
  const https = s.url.startsWith('https:')
  const h = lower(s.doc?.resHeaders)

  // ---------- the network: the document's answer ----------
  if (s.doc) {
    const d = s.doc
    fact('Сеть', 'Ответ', `${d.status ?? '—'} · ${d.proto ?? '?'}`)
    if (d.proto === 'http/1.1') problem('info', 'Сайт отдаётся по HTTP/1.1', 'HTTP/2 или HTTP/3 загружают много файлов параллельно по одному соединению')
    if (h.server) fact('Сеть', 'Сервер', h.server)
    if (h['x-powered-by']) fact('Сеть', 'X-Powered-By', h['x-powered-by'])
    if (/\d/.test(h.server ?? '') || h['x-powered-by']) problem('info', 'Сервер называет себя и версию', 'Заголовки Server / X-Powered-By подсказывают, какие уязвимости пробовать')
    const cdn = CDNS.filter((c) => c.is(h)).map((c) => c.name)
    if (cdn.length) fact('Сеть', 'CDN / хостинг', cdn.join(', '))
    fact('Сеть', 'Сжатие HTML', h['content-encoding'] ?? 'нет', h['content-encoding'] ? undefined : 'mid')
    if (!h['content-encoding'] && (d.size ?? 0) > 2048) problem('mid', 'HTML отдаётся без сжатия', 'Нет Content-Encoding (gzip / br): страница весит больше, чем нужно')
    if (h['cache-control']) fact('Сеть', 'Кэш документа', h['cache-control'])
    if (cacheHit(h)) fact('Сеть', 'Из кэша CDN', 'да')
    if (d.end && d.size !== undefined) fact('Сеть', 'Размер HTML', kb(d.size))
  }

  // ---------- the resources ----------
  const all = s.reqs
  const by = new Map<string, { n: number; bytes: number }>()
  for (const r of all) {
    const k = KIND_OF[r.type] ?? 'Другое'
    const e = by.get(k) ?? { n: 0, bytes: 0 }
    e.n++
    e.bytes += r.size ?? 0
    by.set(k, e)
  }
  fact('Ресурсы', 'Запросов', `${all.length} · ${kb(all.reduce((a, r) => a + (r.size ?? 0), 0))}`)
  for (const [k, e] of [...by].sort((a, b) => b[1].bytes - a[1].bytes)) fact('Ресурсы', k, `${e.n} · ${kb(e.bytes)}`)
  const js = by.get('JS')?.bytes ?? 0
  if (js > 3 * 1024 * 1024) problem('high', `JavaScript весит ${kb(js)}`, 'Столько кода браузер долго скачивает и разбирает: дробите сборку, грузите по требованию')
  else if (js > 1024 * 1024) problem('mid', `JavaScript весит ${kb(js)}`, 'Больше 1 МБ кода — заметная задержка на слабых устройствах')
  const own = siteOf(hostOf(s.url))
  const third = [...new Set(all.map((r) => hostOf(r.url)).filter((x) => x && siteOf(x) !== own))]
  if (third.length) fact('Ресурсы', 'Сторонние домены', `${third.length}: ${third.slice(0, 8).join(', ')}${third.length > 8 ? '…' : ''}`)
  if (third.length > 20) problem('info', `Сторонних доменов: ${third.length}`, 'Каждый — своё соединение и чужой код на странице')
  const failed = all.filter((r) => r.failed || (r.status ?? 0) >= 400)
  if (failed.length) problem('high', `Запросов с ошибкой: ${failed.length}`, failed.slice(0, 5).map((r) => `${r.status ?? r.failed} ${r.url}`).join('\n'))
  const mixed = https ? all.filter((r) => r.url.startsWith('http:')) : []
  if (mixed.length) problem('high', `Смешанное содержимое: ${mixed.length}`, `Страница по HTTPS грузит файлы по HTTP:\n${mixed.slice(0, 5).map((r) => r.url).join('\n')}`)
  const plain = all.filter((r) => (r.size ?? 0) > 1024 && TEXTUAL.test(r.mime ?? '') && r.type !== 'Document' && !lower(r.resHeaders)['content-encoding'] && !r.cached)
  if (plain.length) problem('mid', `Текстовые файлы без сжатия: ${plain.length}`, plain.slice(0, 5).map((r) => `${kb(r.size ?? 0)} ${r.url}`).join('\n'))
  const noCache = all.filter((r) => (r.type === 'Script' || r.type === 'Stylesheet' || r.type === 'Font') && !/max-age=[1-9]|immutable/.test(lower(r.resHeaders)['cache-control'] ?? '') && !lower(r.resHeaders).expires)
  if (noCache.length) problem('info', `Статика без кэширования: ${noCache.length}`, 'Скрипты, стили и шрифты без Cache-Control max-age — браузер спрашивает их снова')
  const bigImg = all.filter((r) => r.type === 'Image' && (r.size ?? 0) > 500 * 1024)
  if (bigImg.length) problem('mid', `Тяжёлые картинки: ${bigImg.length}`, bigImg.slice(0, 5).map((r) => `${kb(r.size ?? 0)} ${r.url}`).join('\n'))
  if (all.length > 150) problem('info', `Запросов при открытии: ${all.length}`, 'Много мелких файлов — объединить или грузить позже')

  // ---------- security ----------
  fact('Безопасность', 'HTTPS', https ? 'да' : 'нет', https ? undefined : 'high')
  if (!https && /^http:/.test(s.url)) problem('high', 'Сайт открыт без HTTPS', 'Данные (и пароли) идут открытым текстом')
  const sec: Array<[string, string, ProblemLevel, string]> = [
    ['strict-transport-security', 'HSTS', 'info', 'Браузер может открыть сайт по HTTP при первом заходе'],
    ['content-security-policy', 'CSP', 'mid', 'Нет политики источников: внедрённый скрипт выполнится без помех (XSS)'],
    ['x-content-type-options', 'X-Content-Type-Options', 'info', 'Без nosniff браузер может угадывать тип файла'],
    ['referrer-policy', 'Referrer-Policy', 'info', 'Адреса страниц уходят на чужие сайты в Referer'],
  ]
  if (s.doc) {
    for (const [k, label, level, why] of sec) {
      fact('Безопасность', label, h[k] ?? 'нет', h[k] ? undefined : level)
      if (!h[k] && (https || k !== 'strict-transport-security')) problem(level, `Нет заголовка ${label}`, why)
    }
    const framed = !!h['x-frame-options'] || /frame-ancestors/i.test(h['content-security-policy'] ?? '')
    fact('Безопасность', 'Защита от встраивания', framed ? (h['x-frame-options'] ?? 'frame-ancestors') : 'нет', framed ? undefined : 'mid')
    if (!framed) problem('mid', 'Страницу можно встроить в чужой сайт', 'Нет X-Frame-Options / frame-ancestors — риск clickjacking')
  }

  // ---------- cookies (the site's own — shown as they are) ----------
  for (const c of s.cookies) {
    const flags = [c.secure ? 'Secure' : '', c.httpOnly ? 'HttpOnly' : '', c.sameSite ? `SameSite=${c.sameSite}` : '', c.session ? 'сессионная' : ''].filter(Boolean).join(' ')
    fact('Cookie', c.name, `${c.value}${flags ? `  · ${flags}` : ''}  · ${c.domain}`)
  }
  const notSecure = https ? s.cookies.filter((c) => !c.secure) : []
  if (notSecure.length) problem('mid', `Cookie без Secure: ${notSecure.length}`, notSecure.map((c) => c.name).join(', '))
  const noneNoSecure = s.cookies.filter((c) => /none/i.test(c.sameSite ?? '') && !c.secure)
  if (noneNoSecure.length) problem('high', 'Cookie SameSite=None без Secure', `Браузер их отбросит: ${noneNoSecure.map((c) => c.name).join(', ')}`)
  const readable = s.cookies.filter((c) => !c.httpOnly && /sess|auth|token|sid|jwt/i.test(c.name))
  if (readable.length) problem('mid', 'Cookie входа доступны JavaScript', `Без HttpOnly их прочтёт внедрённый скрипт: ${readable.map((c) => c.name).join(', ')}`)

  // ---------- the page ----------
  if (s.page) {
    fact('Страница', 'Элементов DOM', String(s.page.nodes), s.page.nodes > 3000 ? 'high' : s.page.nodes > 1500 ? 'mid' : undefined)
    if (s.page.nodes > 1500) problem(s.page.nodes > 3000 ? 'high' : 'mid', `Большой DOM: ${s.page.nodes} элементов`, 'Каждое изменение страницы пересчитывает больше — медленнее отклик')
    if (s.page.blockingScripts) problem('mid', `Скрипты блокируют отрисовку: ${s.page.blockingScripts}`, 'В <head> без async / defer — страница пуста, пока они не загрузятся')
    if (s.page.imgNoSize) problem('info', `Картинки без размеров: ${s.page.imgNoSize}`, 'Без width / height вёрстка прыгает при их загрузке (CLS)')
    if (s.page.imgNoAlt) problem('info', `Картинки без alt: ${s.page.imgNoAlt}`, 'Экранные дикторы их не прочтут')
    if (s.page.frames) fact('Страница', 'Фреймов', String(s.page.frames))
  }
  const heap = s.metrics.JSHeapUsedSize
  if (heap) fact('Страница', 'Память JS', kb(heap), heap > 150 * 1024 * 1024 ? 'mid' : undefined)
  if (heap > 150 * 1024 * 1024) problem('mid', `Страница держит ${kb(heap)} памяти JS`, 'Возможна утечка: растёт ли при действиях?')
  if (s.metrics.JSEventListeners) fact('Страница', 'Обработчиков событий', String(s.metrics.JSEventListeners))
  if (s.errors) problem('mid', `Ошибок в консоли: ${s.errors}`, 'Смотрите группы журнала ниже')

  // ---------- Web Vitals ----------
  for (const v of s.vitals) {
    const r = rateVital(v.name, v.value)
    if (r === 'good') continue
    problem(r === 'poor' ? 'high' : 'mid', `${VITALS[v.name].title}: ${vitalText(v)}`, v.target ? `Элемент: ${v.target}` : undefined)
  }
  const order: Record<ProblemLevel, number> = { high: 0, mid: 1, info: 2 }
  problems.sort((a, b) => order[a.level] - order[b.level])
  return { facts, problems }
}
/** A metric's value in its unit. */
export function vitalText(v: VitalValue): string {
  return v.name === 'CLS' ? v.value.toFixed(3) : v.value >= 1000 ? `${(v.value / 1000).toFixed(2)} с` : `${Math.round(v.value)} мс`
}
