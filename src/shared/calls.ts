import { firstFreeLane, overlap } from './timeline'
import type { CallSegment, DayData, Entry, KindDef } from './types'

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
    if (!e || e.end >= call.end) return false
    e.end = call.end
    return true
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
    label: `Созвон ${call.app}`,
    source: 'detected',
    lane: firstFreeLane(d.entries, call.start, call.end),
  }
  d.entries.push(entry)
  call.entryId = entry.id
  return true
}
