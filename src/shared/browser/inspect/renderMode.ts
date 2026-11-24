import type { RenderInfo } from './types'

/**
 * How the page is made, from what it showed: the server's HTML against the page drawn (rendered on the server or in
 * the browser), the frameworks' marks (hydration, islands, pre-built pages), the routes of a single-page app, a
 * manifest and a service worker (a PWA).
 */

/** The marks a page's frameworks leave (the page's probe reports which are there). */
export const RENDER_MARKS = {
  nextData: 'Next.js: __NEXT_DATA__',
  nextStatic: 'Next.js: страница собрана заранее',
  nextSsr: 'Next.js: getServerSideProps',
  nextApp: 'Next.js App Router (RSC)',
  nuxt: 'Nuxt: __NUXT__',
  nuxtPrerendered: 'Nuxt: страница собрана заранее',
  vueSsr: 'Vue: data-server-rendered',
  angularHydration: 'Angular: гидратация (ngh)',
  angularServer: 'Angular: ng-server-context',
  sveltekit: 'SvelteKit',
  remix: 'Remix / React Router',
  gatsby: 'Gatsby',
  astroIsland: 'Astro: острова',
  qwik: 'Qwik: q:container',
  reactRoot: 'React: корень приложения',
  vueApp: 'Vue: приложение (data-v-app)',
} as const
export type RenderMark = keyof typeof RENDER_MARKS
/** The marks that tell the page was hydrated after the server drew it. */
const HYDRATION: RenderMark[] = ['nextData', 'nextApp', 'nuxt', 'vueSsr', 'angularHydration', 'angularServer', 'sveltekit', 'remix', 'gatsby', 'qwik', 'astroIsland']
const PREBUILT: RenderMark[] = ['nextStatic', 'nuxtPrerendered', 'gatsby']

export interface RenderSignals {
  /** The text of the server's HTML (scripts and styles left out), its length; unknown — undefined. */
  serverText?: number
  /** The text of the page as drawn now. */
  pageText: number
  marks: readonly RenderMark[]
  /** The answer came from a cache (a CDN's HIT, Age > 0). */
  cached: boolean
  /** Routes taken without a page load (history.pushState / popstate). */
  softNavs: number
  manifest: boolean
  worker: boolean
  installable?: boolean
}

/** The text of an HTML document as a person would read it (no scripts, styles, tags; spaces collapsed). */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** How the page is made, and why it is said so. */
export function renderInfo(s: RenderSignals): RenderInfo {
  const why: string[] = []
  const has = (m: RenderMark) => s.marks.includes(m)
  const fw = s.marks.filter((m) => HYDRATION.includes(m))
  let render: RenderInfo['render'] = 'unknown'
  if (s.serverText !== undefined) {
    const share = s.pageText ? s.serverText / s.pageText : 0
    if (s.serverText >= 200 && share >= 0.3) {
      render = 'ssr'
      why.push(`HTML сервера уже содержит текст страницы (${Math.round(Math.min(1, share) * 100)}% того, что видно)`)
    } else if (s.serverText < 100 && s.pageText > 0) {
      render = 'csr'
      why.push('HTML сервера почти пустой — страницу рисует JavaScript в браузере')
    } else why.push('HTML сервера содержит лишь часть текста — смешанная отрисовка')
  } else why.push('HTML сервера не получен — отрисовка определена по меткам')
  if (render === 'unknown' && fw.length) render = 'ssr'
  if ((render === 'ssr' || render === 'unknown') && (PREBUILT.some(has) || (s.cached && render === 'ssr'))) {
    render = 'ssg'
    why.push(PREBUILT.some(has) ? 'страница собрана заранее (статическая генерация)' : 'ответ пришёл из кэша CDN — вероятно, статическая или кэшированная')
  }
  if (has('nextSsr')) {
    render = 'ssr'
    why.push('рисуется на сервере при каждом запросе')
  }
  const hydrated = (render === 'ssr' || render === 'ssg') && fw.length > 0
  if (fw.length) why.push(`метки: ${fw.map((m) => RENDER_MARKS[m]).join(', ')}`)
  const islands = has('astroIsland') || has('qwik')
  if (islands) why.push('интерактивны только отдельные части страницы (острова)')
  const spa = s.softNavs > 0 || render === 'csr' || (hydrated && !islands) || has('reactRoot') || has('vueApp')
  if (s.softNavs > 0) why.push(`переходов без перезагрузки: ${s.softNavs}`)
  return { render, hydrated, islands, spa, pwa: { manifest: s.manifest, worker: s.worker, ...(s.installable !== undefined ? { installable: s.installable } : {}) }, why }
}

/** How the page is made, in a line. */
export function renderLine(r: RenderInfo): string {
  const how = { ssr: 'SSR (сервер)', ssg: 'SSG (собрана заранее)', csr: 'CSR (браузер)', unknown: 'отрисовка не ясна' }[r.render]
  const parts = [how + (r.hydrated ? ' + гидратация' : ''), r.islands ? 'острова' : '', r.spa ? 'SPA' : 'многостраничный', r.pwa.manifest && r.pwa.worker ? (r.pwa.installable === false ? 'PWA (не устанавливается)' : 'PWA') : r.pwa.worker ? 'service worker' : '']
  return parts.filter(Boolean).join(' · ')
}
