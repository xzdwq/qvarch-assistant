import { firstFreeLane, overlap } from './timeline'
import type { CallSegment, DayData, Entry, KindDef } from './types'

/** Main-window sections of the call apps — their titles are not the call's. */
const NOT_CALL = /^(чат|активность|календарь|команды|звонки|файлы|приложения|chat|activity|calendar|teams|calls|files|apps|onedrive|сообщество|community|уведомлени|notification)\b|^(microsoft teams|zoom( workplace| meetings)?|telegram|slack|skype)$/i

/** The process names of a call app (as `isCallApp` names it). */
const PROC: Record<string, RegExp> = { Teams: /teams/i, Zoom: /zoom/i, Telegram: /telegram/i, Slack: /slack/i, Skype: /skype/i }

/** "Иванов Иван | Microsoft Teams" → "Иванов Иван". */
export const cleanCallTitle = (t: string): string =>
  t
    .replace(/\s*[|—–-]\s*(microsoft teams|zoom( workplace)?|telegram|slack|skype)\s*$/i, '')
    .replace(/\s*\|\s*(microsoft teams)\s*$/i, '')
    .trim()

/**
 * Who the call is with: among the call app's windows (`windows` — "process\ttitle") one that is not a
 * main-window section; a window that was not there before the call (`before`) is preferred.
 */
export function callTitle(app: string, windows: string[], before: ReadonlySet<string> = new Set()): string | undefined {
  const proc = PROC[app]
  if (!proc) return undefined
  const titles = windows
    .map((w) => w.split('\t'))
    .filter(([p, t]) => proc.test(p ?? '') && t)
    .map(([, t]) => t)
    .filter((t) => {
      const c = cleanCallTitle(t)
      return c.length > 1 && !NOT_CALL.test(c) && !/^\S+\s*\|/.test(c)
    })
  const pick = titles.find((t) => !before.has(t)) ?? titles[0]
  return pick ? cleanCallTitle(pick) : undefined
}

/** The label of a detected call's block. */
export const callLabel = (call: CallSegment): string => (call.title ? `Созвон: ${call.title}` : `Созвон ${call.app}`)

/** A call shorter than this does not become a block (mic flicker). Teams may hold the mic only while unmuted. */
export const CALL_ENTRY_MIN_MS = 10_000

function callKind(kinds: KindDef[]): string {
  return kinds.find((k) => k.id === 'call')?.id ?? kinds[0]?.id ?? 'call'
}

/**
 * Keeps a timeline block in sync with a detected call: created once the call lasts 30 seconds
 * (on the first free lane — below if the main line is taken), extended while it goes on.
 * A block the user deleted is not re-created. Returns true when the day changed.
 */
export function syncCallEntry(d: DayData, call: CallSegment, kinds: KindDef[], newId: () => string): boolean {
  if (call.end - call.start < CALL_ENTRY_MIN_MS) return false
  if (call.entryId) {
    const e = d.entries.find((x) => x.id === call.entryId)
    if (!e) return false
    let changed = false
    // the title arrived later — the block still has the automatic label: name it
    if (e.source === 'detected' && call.title && /^Созвон /.test(e.label) && e.label !== callLabel(call)) {
      e.label = callLabel(call)
      changed = true
    }
    if (e.end < call.end) {
      e.end = call.end
      changed = true
    }
    return changed
  }
  // the user already marked this call by hand → just link it
  const manual = d.entries.find((e) => e.kind === callKind(kinds) && overlap(e.start, e.end, call.start, call.end) >= (call.end - call.start) / 2)
  if (manual) {
    call.entryId = manual.id
    return true
  }
  const entry: Entry = {
    id: newId(),
    start: call.start,
    end: call.end,
    kind: callKind(kinds),
    label: callLabel(call),
    source: 'detected',
    lane: firstFreeLane(d.entries, call.start, call.end),
  }
  d.entries.push(entry)
  call.entryId = entry.id
  return true
}
