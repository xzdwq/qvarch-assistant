import { kindMeta, reqLine, type CheckProblem, type CheckReq } from './check'

/**
 * A bug as a note: what is filled in by hand (steps, expected, actual) and what the browser found — each finding
 * with its request as a runnable ```http block (run it again from the note) and the answer it got, the page's
 * picture, and the bug's history (later checks and retests are written under it).
 */
export interface BugDraft {
  title: string
  page: string
  steps: string
  expected: string
  actual: string
  problems: CheckProblem[]
  /** The recorded scenario (Playwright lines) — runnable from the note. */
  scenario?: string[]
  /** vault/.images/… — the page as it was. */
  shot?: string
  when: number
}

const fmt = (t: number) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const hostOf = (u: string) => {
  try {
    return new URL(u).host
  } catch {
    return u
  }
}
/** A body made readable: JSON indented, the rest as is; cut when long. */
function pretty(s: string | undefined, max: number): string {
  if (!s) return ''
  let out = s
  if (/^\s*[[{]/.test(s)) {
    try {
      out = JSON.stringify(JSON.parse(s), null, 2)
    } catch {
      // as is
    }
  }
  return out.length > max ? `${out.slice(0, max)}\n… (обрезано, всего ${out.length} символов)` : out
}
/** A fence that the text inside cannot close. */
const fence = (text: string) => '`'.repeat(Math.max(3, ...[...text.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)))
function httpBlock(r: CheckReq, n: number): string {
  // (the request whole — it runs again from the journal; never cut)
  const body = pretty(r.reqBody, Infinity)
  const lines = [`${r.method} ${r.url}`, ...(body ? [`Content-Type: ${r.contentType || 'application/json'}`, '', body] : [])]
  const text = lines.join('\n')
  const f = fence(text)
  return `${f}http name=req${n}\n${text}\n${f}`
}
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
const fmtSpan = (a: number, b: number) => {
  const t = (x: number) => new Date(x).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return b - a > 1000 ? `${fmt(a)} – ${t(b)}` : fmt(a)
}
/** Exactly where: the request (a spinner — the one it waits for), the message, the cell's text — never only the kind. */
export function whereOf(p: CheckProblem): string {
  if (p.kind === 'loading') return p.req ? `ждём ${reqLine({ method: p.req.method, url: p.req.url })}` : 'без запросов в сети'
  if (p.req) return reqLine(p.req)
  if (p.kind === 'console') return p.title.replace(/^Консоль: /, '')
  if (p.kind === 'toast') return p.title.replace(/^Сообщение об ошибке: /, '')
  return p.title
}
/** The same finding picked twice (the same kind, the same place) — one row, its counts added up. */
export function mergeFound(list: CheckProblem[]): CheckProblem[] {
  const out: CheckProblem[] = []
  for (const p of [...list].sort((a, b) => a.at - b.at)) {
    const same = out.find((x) => x.kind === p.kind && whereOf(x) === whereOf(p))
    if (!same) out.push({ ...p })
    else {
      same.count += p.count
      same.last = Math.max(same.last, p.last)
      if (!same.req && p.req) same.req = p.req
      if (p.detail && !same.detail?.includes(p.detail)) same.detail = same.detail ? `${same.detail}\n${p.detail}` : p.detail
    }
  }
  return out
}

export function bugNote(d: BugDraft): string {
  // (the title is the note's name — the notebook shows it over the text)
  const found0 = d.problems.length
  const out: string[] = [`> [!${found0 ? 'warning' : 'info'}] Журнал · ${fmt(d.when)} · ${hostOf(d.page)}${found0 ? ` · найдено: ${found0}` : ''}`, `> Страница: ${d.page}`, '']
  out.push('## Шаги', '', d.steps.trim() || `1. Открыть ${d.page}\n2. `, '')
  if (d.scenario?.length) {
    const code = d.scenario.join('\n')
    const f = fence(code)
    out.push('Сценарий (запустить ▶ — повторит шаги в браузере с вашим входом):', '', `${f}ts playwright session name=steps`, code, f, '')
  }
  // (a journal's entry is not always a bug: expected / actual — when said)
  if (d.expected.trim()) out.push('## Ожидаемый результат', '', d.expected.trim(), '')
  if (d.actual.trim()) out.push('## Фактический результат', '', d.actual.trim(), '')
  const found = mergeFound(d.problems)
  if (found.length) {
    // the summary: what, exactly where (the request / the element / the message), how many times, when
    out.push('## Найдено автоматически', '', '| # | Что | Где именно | Раз | Когда |', '| --- | --- | --- | --- | --- |')
    found.forEach((p, i) => out.push(`| ${i + 1} | ${cell(kindMeta(p.kind).label)} | ${cell(whereOf(p))} | ${p.count} | ${fmtSpan(p.at, p.last)} |`))
    out.push('')
    // each finding whole: where, what exactly, its request (runnable) and the answer
    let n = 0
    found.forEach((p, i) => {
      out.push(`### ${i + 1}. ${kindMeta(p.kind).label}: ${whereOf(p)}`, '')
      out.push(`- **Когда:** ${fmtSpan(p.at, p.last)}${p.count > 1 ? ` · повторилось ${p.count} раз` : ''}`, `- **Страница:** ${p.page}`)
      if (p.selector) out.push(`- **Элемент:** \`${p.selector}\``)
      out.push('')
      if (p.detail) out.push(p.detail.trim(), '')
      if (p.req) {
        out.push(httpBlock(p.req, ++n), '')
        if (p.req.reqBodyCut) out.push(`Тело запроса было слишком большим (${p.req.reqBodyCut.toLocaleString('ru-RU')} символов) и не сохранено — запрос выше без тела.`, '')
        if (p.req.status !== undefined) out.push(`Ответ: **${p.req.status}**${p.req.ms !== undefined ? ` за ${p.req.ms} мс` : ''}`, '')
        else out.push('Ответ: не пришёл к моменту находки', '')
        const res = pretty(p.req.resBody, 6000)
        if (res) {
          const f = fence(res)
          out.push(`${f}${/^\s*[[{]/.test(res) ? 'json' : 'text'}`, res, f, '')
        }
      }
    })
  }
  if (d.shot) out.push('## Скриншот', '', `![[${d.shot}]]`, '')
  out.push('## История', '', `- ${fmt(d.when)} — записано из «Проверки» в браузере`, '')
  return out.join('\n')
}

// ---------- the recorded steps in words ----------
/** A JS string / regex literal as its text: 'a\'b' → a'b, /^Название/i → Название. */
function unq(lit: string): string {
  if (lit.startsWith('/')) return lit.replace(/^\/\^?/, '').replace(/\$?\/[a-z]*$/, '').replace(/\\(.)/g, '$1')
  return lit.slice(1, -1).replace(/\\(.)/g, '$1')
}
const LIT = String.raw`('(?:[^'\\]|\\.)*'|\/(?:[^/\\]|\\.)+\/[a-z]*)`
/** What a locator points at, in words: «Сохранить», поле «Название», «Открыть» в строке «Артикул 1». */
function target(loc: string): string {
  const all = [...loc.matchAll(new RegExp(String.raw`(?:(name|hasText)\s*:\s*${LIT}|getBy(Text|Label|Placeholder|Title|TestId|AltText)\(${LIT})`, 'g'))]
  if (!all.length) return 'элемент'
  const last = all[all.length - 1]
  const text = unq(last[2] ?? last[4])
  const isField = /q-field__label/.test(loc) || last[3] === 'Label' || last[3] === 'Placeholder' || /getByRole\('(textbox|combobox|searchbox|spinbutton)'/.test(loc)
  let s = isField ? `поле «${text}»` : last[3] === 'TestId' ? `«${text}» (data-testid)` : `«${text}»`
  const row = /tbody tr'\s*,\s*\{\s*hasText:\s*('(?:[^'\\]|\\.)*')/.exec(loc)
  if (row && unq(row[1]) !== text) s += ` в строке «${unq(row[1])}»`
  const dlg = /\[role="dialog"\]'\)\.filter\(\{\s*hasText:\s*('(?:[^'\\]|\\.)*')/.exec(loc)
  if (dlg && unq(dlg[1]) !== text) s += ` в окне «${unq(dlg[1])}»`
  return s
}
/** Playwright lines (as recorded) → numbered steps a person reads. */
export function stepsFromPw(lines: string[]): string {
  const out: string[] = []
  for (const raw of lines) {
    const l = raw.trim().replace(/^await\s+/, '')
    if (!l || l.startsWith('//')) continue
    // the recorder described the step itself, with the page in front of it
    const said = /\/\/ шаг: (.+)$/.exec(l)
    if (said) {
      // «-»: a check the recorder added after a step (the step says it already)
      if (said[1].trim() !== '-') out.push(said[1].trim())
      continue
    }
    let m: RegExpExecArray | null
    if ((m = new RegExp(String.raw`^page\.goto\(${LIT}`).exec(l))) out.push(`Открыть ${unq(m[1])}`)
    else if ((m = new RegExp(String.raw`^page\.waitForURL\(${LIT}`).exec(l))) out.push(`Дождаться перехода на ${unq(m[1])}`)
    else if ((m = new RegExp(String.raw`^page\.keyboard\.press\(${LIT}`).exec(l))) out.push(`Нажать клавишу ${unq(m[1])}`)
    else if ((m = new RegExp(String.raw`^expect\((.+)\)\.toContainText\(${LIT}`).exec(l))) out.push(`Убедиться, что в ${target(m[1])} — «${unq(m[2])}»`)
    else if ((m = /^(.+)\.(click|dblclick|check|uncheck)\(\)/.exec(l))) out.push(`${{ click: 'Нажать', dblclick: 'Дважды нажать', check: 'Отметить', uncheck: 'Снять отметку' }[m[2]]} ${target(m[1])}`)
    else if ((m = new RegExp(String.raw`^(.+)\.fill\(${LIT}\)`).exec(l))) out.push(/пароль/.test(raw) ? `Ввести пароль в ${target(m[1])}` : unq(m[2]) ? `Ввести «${unq(m[2])}» в ${target(m[1])}` : `Очистить ${target(m[1])}`)
    else if ((m = new RegExp(String.raw`^(.+)\.selectOption\(${LIT}\)`).exec(l))) out.push(`Выбрать «${unq(m[2])}» в ${target(m[1])}`)
    else if ((m = new RegExp(String.raw`^(.+)\.press\(${LIT}\)`).exec(l))) out.push(`Нажать клавишу ${unq(m[2])} в ${target(m[1])}`)
    else out.push(l.replace(/;$/, ''))
  }
  return out.map((s, i) => `${i + 1}. ${s}`).join('\n')
}

/** A short name for the note: the bug's title without what a file name cannot hold. */
export const bugFileName = (title: string) => title.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Запись'
