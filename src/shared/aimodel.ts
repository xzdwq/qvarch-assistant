import { isProductive, productiveSplit, unlabelledMs } from './kinds'
import { noteEntry, visibleNotes } from './notes'
import { clipEntries, formatHM, mergeIntervals, scheduleRanges } from './timeline'
import type { DayData, KindDef, Ms, Settings } from './types'

/** The prompt the analysis starts from (editable in settings). */
export const DEFAULT_AI_PROMPT = `Ты — ассистент по личной продуктивности. Тебе дана компактная JSON-модель рабочего дня пользователя: время — HH:MM, длительности — в минутах.
Поля: workday — официальный график; totals — итоги дня; blocks — размеченные блоки (kind — вид, task — задача Jira, lane > 0 — шло параллельно); notes — заметки; apps — время по приложениям; timeline — по получасам: главные приложения и простой; activity — по часам: нажатия клавиш, переключения окон, пробег мыши.

Составь итог на русском в Markdown строго по разделам:
## Итог дня
3–5 пунктов: чем был занят день, ключевые блоки и задачи Jira.
## Время
Таблица «Что | Время»: виды занятости и задачи Jira, отдельной строкой — неразмеченное время.
## Эффективность
Оценка от 1 до 10 и короткое обоснование: доля продуктивного времени в рабочие часы, фокус (длинные непрерывные отрезки), переключения окон, простой, переработки.
## Советы
2–3 конкретных, применимых завтра совета.

Опирайся только на данные модели, ничего не выдумывай; если данных мало — так и скажи.`

const min = (ms: number) => Math.round(ms / 60_000)
const SLOT = 30 * 60_000

/**
 * A compact model of a day for the AI: blocks and notes as they are, apps folded into totals and
 * half-hour slots (1–2 main apps per slot) — so a day of thousands of window switches stays a few KB.
 * Window titles go only with `withTitles` (they may contain private text).
 */
export function buildDayModel(d: DayData, settings: Pick<Settings, 'schedule' | 'kinds'>, now: Ms, withTitles = false) {
  const kinds: KindDef[] = settings.kinds
  const kindLabel = (id: string) => kinds.find((k) => k.id === id)?.label ?? id
  const entries = clipEntries(d.entries, now)
  const spans = d.spans.map((s) => ({ start: s.start, end: Math.min(s.end, now) })).filter((s) => s.end > s.start)
  const { work, lunch } = scheduleRanges(d.day, settings.schedule)
  const split = productiveSplit(entries, kinds, work, lunch)
  const activity = d.activity.filter((a) => a.start < now)
  const active = activity.filter((a) => a.kind !== 'idle' && a.kind !== 'locked')

  // apps: totals, sessions, (optionally) the most used titles
  const apps = new Map<string, { kind: string; ms: number; sessions: number; titles: Map<string, number> }>()
  for (const a of active) {
    const x = apps.get(a.app) ?? { kind: a.kind, ms: 0, sessions: 0, titles: new Map() }
    x.ms += a.end - a.start
    x.sessions++
    if (withTitles && a.title) x.titles.set(a.title, (x.titles.get(a.title) ?? 0) + (a.end - a.start))
    apps.set(a.app, x)
  }

  // half-hour slots: the 1–2 apps that took most of it (≥ 3 min), idle minutes
  const timeline: Array<{ from: string; to: string; top: Array<{ app: string; min: number }>; idleMin: number }> = []
  if (activity.length) {
    const first = Math.floor(activity[0].start / SLOT) * SLOT
    for (let t = first; t < now; t += SLOT) {
      const byApp = new Map<string, number>()
      let idle = 0
      for (const a of activity) {
        const o = Math.min(a.end, t + SLOT) - Math.max(a.start, t)
        if (o <= 0) continue
        if (a.kind === 'idle' || a.kind === 'locked') idle += o
        else byApp.set(a.app, (byApp.get(a.app) ?? 0) + o)
      }
      if (!byApp.size && !idle) continue
      const top = [...byApp].sort((a, b) => b[1] - a[1]).slice(0, 2).filter(([, ms]) => ms >= 3 * 60_000)
      timeline.push({ from: formatHM(t), to: formatHM(t + SLOT), top: top.map(([app, ms]) => ({ app, min: min(ms) })), idleMin: min(idle) })
    }
  }

  // activity per hour from the stored minute bins
  const byHour = new Map<number, { keys: number; switches: number; mouseM: number }>()
  for (const [minute, k, m, s] of d.pulse ?? []) {
    const h = Math.floor(minute / 60)
    const x = byHour.get(h) ?? { keys: 0, switches: 0, mouseM: 0 }
    x.keys += k
    x.switches += s
    x.mouseM += m / 3780 // ~px → metres (96 dpi)
    byHour.set(h, x)
  }

  return {
    date: d.day,
    weekday: new Date(`${d.day}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long' }),
    workday: work ? { start: formatHM(work[0]), end: formatHM(work[1]), lunch: lunch ? `${formatHM(lunch[0])}–${formatHM(lunch[1])}` : null } : null,
    totals: {
      qaOnMin: min(spans.reduce((a, s) => a + (s.end - s.start), 0)),
      firstStart: spans.length ? formatHM(Math.min(...spans.map((s) => s.start))) : null,
      lastEnd: spans.length ? formatHM(Math.max(...spans.map((s) => s.end))) : null,
      activeInAppsMin: min(active.reduce((a, x) => a + (x.end - x.start), 0)),
      productiveMin: min(split.total),
      productiveInWorkHoursMin: min(split.within),
      overtimeMin: min(split.over),
      unlabelledMin: min(unlabelledMs(entries, spans)),
      callsMin: min(mergeIntervals(d.calls.filter((c) => c.start < now), 60_000).reduce((a, c) => a + (c.end - c.start), 0)),
      bestTypingCombo: d.combo?.best ?? 0,
    },
    blocks: [...entries]
      .sort((a, b) => a.start - b.start)
      .map((e) => ({
        from: formatHM(e.start),
        to: formatHM(e.end),
        min: min(e.end - e.start),
        kind: kindLabel(e.kind),
        productive: isProductive(kinds, e.kind),
        label: e.label,
        ...(e.description ? { description: e.description.slice(0, 400) } : {}),
        ...(e.task ? { task: `${e.task.key} ${e.task.summary}` } : {}),
        ...(e.lane ? { lane: e.lane } : {}),
        ...(e.source === 'detected' ? { auto: true } : {}),
      })),
    notes: visibleNotes(d.notes).map((n) => {
      const e = noteEntry(n, d.entries)
      return { at: formatHM(n.at), text: n.text.slice(0, 400), ...(e ? { block: e.label } : {}) }
    }),
    apps: [...apps]
      .sort((a, b) => b[1].ms - a[1].ms)
      .slice(0, 12)
      .map(([app, x]) => ({
        app,
        kind: x.kind,
        min: min(x.ms),
        sessions: x.sessions,
        ...(withTitles && x.titles.size
          ? { titles: [...x.titles].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t.slice(0, 80)) }
          : {}),
      })),
    timeline,
    activity: [...byHour]
      .sort((a, b) => a[0] - b[0])
      .map(([h, x]) => ({ hour: `${String(h).padStart(2, '0')}:00`, keys: x.keys, switches: x.switches, mouseM: Math.round(x.mouseM) })),
  }
}
