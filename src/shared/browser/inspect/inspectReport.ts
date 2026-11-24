import { groupSummary } from './actionLog'
import { ANIM_COST_WORDS, REQ_WORDS } from './constants'
import { renderLine } from './renderMode'
import { kb, vitalText } from './siteFacts'
import type { ActionGroup, InspectView } from './types'

/** The last groups a report tells (the newest), and the requests of each. */
const REPORT_GROUPS = 30
const REPORT_REQS = 25

export const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} с` : `${Math.round(n)} мс`)

/** A group's line: what was done, how long, its requests (all together / as the clock saw them), its errors. */
export function groupLine(g: ActionGroup): string {
  const s = groupSummary(g)
  const parts = [ms(s.duration)]
  if (s.count) parts.push(`${s.count} запр. · Σ ${ms(s.sum)} · по часам ${ms(s.wall)}${s.bytes ? ` · ${kb(s.bytes)}` : ''}`)
  if (s.failed) parts.push(`ошибок запросов: ${s.failed}`)
  if (s.errors) parts.push(`ошибок консоли: ${s.errors}`)
  if (g.busy.total) parts.push(`занят поток: ${ms(g.busy.total)}`)
  if (g.response) parts.push(`отклик ${ms(g.response.total)}`)
  return parts.join(' · ')
}

/**
 * The inspector's report as Markdown (for an AI, for a bug): the passport — what the site is made with, how it is
 * drawn, its vitals, its problems — and the log of acts, the newest last, each with its slow / failed requests and errors.
 */
export function inspectReport(v: InspectView, title: string): string {
  const out: string[] = [`# Разбор страницы: ${title}`]
  const p = v.passport
  if (p) {
    out.push(`Адрес: ${p.url}`)
    if (p.render) out.push(`**Как сделан:** ${renderLine(p.render)}`, ...p.render.why.map((w) => `- ${w}`))
    if (p.tech.length) {
      const byCat = new Map<string, string[]>()
      for (const t of p.tech) for (const c of t.cats.length ? t.cats : ['Прочее']) byCat.set(c, [...(byCat.get(c) ?? []), `${t.name}${t.version ? ` ${t.version}` : ''}`])
      out.push('## Технологии', ...[...byCat].map(([c, n]) => `- ${c}: ${n.join(', ')}`))
    }
    if (p.vitals.length) out.push('## Web Vitals', ...p.vitals.map((x) => `- ${x.name}: ${vitalText(x)} (${x.rating})${x.target ? ` — \`${x.target}\`` : ''}`))
    if (p.problems.length) out.push('## Проблемы', ...p.problems.map((x) => `- [${x.level}] ${x.title}${x.detail ? `: ${x.detail.replace(/\n/g, '; ')}` : ''}`))
    const facts = p.facts.filter((f) => f.group !== 'Cookie')
    if (facts.length) out.push('## Факты', ...facts.map((f) => `- ${f.group} / ${f.label}: ${f.value}`))
  } else out.push('Паспорт сайта ещё не собран.')
  const groups = v.groups.slice(-REPORT_GROUPS)
  if (groups.length) out.push('## Журнал действий')
  for (const g of groups) {
    out.push(`### ${g.label}${g.target ? ` (\`${g.target}\`)` : ''}`, groupLine(g))
    const reqs = [...g.reqs].sort((a, b) => (b.end ?? b.start) - b.start - ((a.end ?? a.start) - a.start)).slice(0, REPORT_REQS)
    for (const r of reqs) out.push(`- ${r.method} ${r.url} — ${r.failed ?? r.status ?? '…'} · ${REQ_WORDS[r.type] ?? r.type} · ${r.end ? ms(r.end - r.start) : 'идёт'}`)
    for (const n of g.notes) out.push(`- **${n.level}:** ${n.text.slice(0, 500)}${n.where ? ` (${n.where})` : ''}`)
    for (const s of g.busy.scripts) out.push(`- поток занят: ${s.src} — ${ms(s.ms)}`)
    if (g.scroll) out.push(`- прокрутка ${g.scroll.distance} px за ${ms(g.scroll.ms)}, ${g.scroll.fps} кадров/с, рывков ${g.scroll.slow}; элементов добавлено ${g.scroll.added}, удалено ${g.scroll.removed}`)
    for (const a of g.anims.slice(0, 10)) out.push(`- ${a.kind === 'transition' ? 'переход' : 'анимация'} ${a.name} на \`${a.target}\` (${a.props.join(', ') || '—'}; ${ANIM_COST_WORDS[a.cost]})`)
  }
  if (v.anims.length) out.push('## Анимации страницы', ...v.anims.slice(0, 15).map((a) => `- ${a.name} на \`${a.target}\`: ×${a.count}, ${ANIM_COST_WORDS[a.cost]}${a.running ? `, идёт сейчас${a.infinite ? ' (бесконечная)' : ''}` : ''}`))
  return out.join('\n')
}
