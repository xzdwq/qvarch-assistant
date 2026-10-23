import { blockSpec, isRunnableKind, type RunnableKind } from '../blocks/specs'
import type { BlockInfo } from '../domain/blockInfo'
import { fencedBlocksOf } from '../domain/noteBlocks'
import { cutText, indentText, momentText, tookText } from './reportText'
import { BLOCK_RUNNERS } from './runners'
import { noteRun } from './runStore'
import type { LoopRun, PassRun, RunState } from './runTypes'

/** Run reports to copy, for a person: a chat, a Jira comment, an e-mail. */

/** A run's state as the report's mark (an expected failure — a warning). */
const STATE_MARK: Record<RunState, string> = { run: '⏳', ok: '✅', error: '❌' }
const stateMark = (state: RunState, soft = false) => (state === 'error' && soft ? '⚠️' : STATE_MARK[state])

/** One block's last run as text: what was checked, how it went, the error, the result. */
export function blockReport(path: string, key: string, kind: RunnableKind, info: BlockInfo, body: string, opts: { brief?: boolean } = {}): string {
  const r = noteRun(path).runs[key]
  const spec = blockSpec(kind)
  const title = `${spec.reportTitle ?? spec.title} «${info.name ?? key}»`
  if (!r) return `⏸ ${title} — не запускался`
  const brief = !!opts.brief
  const runner = BLOCK_RUNNERS[kind]
  const ctx = { info, body, brief }
  const out = [`${stateMark(r.state, info.soft)} ${title} — ${runner.reportHeadline(r, ctx)}`, ...(runner.reportDetails?.(r, ctx) ?? [])]
  if (r.error) out.push(brief ? `Ошибка: ${cutText(r.error.split('\n')[0], 300)}` : `Ошибка:\n${indentText(cutText(r.error.split('\n').slice(0, 14).join('\n'), 2000))}`)
  if (!brief) {
    const logs = (r.logs ?? []).filter((l) => !/^Вход (из Браузера|сохранён)/.test(l.text))
    if (logs.length) out.push(`Лог:\n${indentText(cutText(logs.map((l) => (l.level === 'error' || l.level === 'warn' ? `[${l.level}] ` : '') + l.text).join('\n'), 1500))}`)
    if (r.hasValue) out.push(`Результат: ${cutText(typeof r.value === 'string' ? r.value : JSON.stringify(r.value, null, 2), 1500)}`)
    out.push(...(runner.reportExtras?.(r) ?? []))
    out.push(`Запуск: ${momentText(r.at)}`)
  }
  return out.join('\n')
}

/** The whole note: a summary line, every runnable block in order (the failed ones and the tests in full). */
export function noteReport(path: string, noteText: string): string {
  const blocks = fencedBlocksOf(noteText).flatMap((b) => (isRunnableKind(b.kind) && !b.info.lib ? [{ ...b, kind: b.kind }] : []))
  const n = noteRun(path)
  const runs = blocks.map((b) => n.runs[b.key])
  const okN = runs.filter((r) => r?.state === 'ok').length
  const bad = blocks.filter((b, i) => runs[i]?.state === 'error' && !b.info.soft).length
  const soft = blocks.filter((b, i) => runs[i]?.state === 'error' && b.info.soft).length
  const none = runs.filter((r) => !r).length
  const tests = blocks.filter((b) => b.kind === 'pw')
  const title = (noteText.match(/^#\s+(.+)$/m)?.[1] ?? path.split('/').pop()!.replace(/\.md$/i, '')).trim()
  const last = Math.max(0, ...runs.map((r) => r?.at ?? 0))
  const head = [
    `📋 ${title}`,
    `${bad ? '❌ Есть ошибки' : none === blocks.length ? '⏸ Не запускалось' : '✅ Всё в порядке'} — успешно ${okN} из ${blocks.length}${soft ? `, ожидаемых падений ${soft}` : ''}${bad ? `, ошибок ${bad}` : ''}${none ? `, не запускалось ${none}` : ''}`,
    ...(tests.length ? [`Тесты в браузере: ${tests.filter((b) => n.runs[b.key]?.state === 'ok').length} из ${tests.length}`] : []),
    ...(last ? [`Последний запуск: ${momentText(last)}`] : []),
  ]
  const parts = blocks.map((b, i) => blockReport(path, b.key, b.kind, b.info, b.body, { brief: !(runs[i]?.state === 'error' || b.kind === 'pw') }))
  return [...head, '', ...parts.flatMap((p) => [p, ''])].join('\n').trim()
}

/** A loop's last run as text: its passes, the failed ones (20 at most), its error. */
export function loopReport(lr: LoopRun | undefined, title: string): string {
  if (!lr) return ''
  const bad = lr.passes.filter((p) => p.state === 'error').length
  return [
    `${stateMark(lr.state)} Цикл «${title}» — проходов ${lr.passes.length}${bad ? `, с ошибкой ${bad}` : ''}${tookText(lr.ms)}`,
    ...(lr.error ? [`Ошибка: ${lr.error}`] : []),
    ...lr.passes
      .filter((p) => p.error)
      .slice(0, 20)
      .map((p) => `  ❌ ${passTitle(p)}: ${p.error}`),
  ].join('\n')
}
/** A pass in a few words: its number and its plain values (`№ 3 · i=2 · id=17`). */
export function passTitle(p: PassRun): string {
  const vs = Object.entries(p.vars)
    .filter(([, v]) => isPlainValue(v))
    .slice(0, 4)
    .map(([k, v]) => `${k}=${String(v).length > 24 ? `${String(v).slice(0, 24)}…` : String(v)}`)
  return [`№ ${p.n}`, ...vs].join(' · ')
}
/** A value a table cell shows as it is (a number, a text, true / false, null). */
export const isPlainValue = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v)
