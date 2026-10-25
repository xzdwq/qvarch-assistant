import type { ResultsPut, ResultsPutReply, SharedResult } from '../../shared/transport/protocol'
import type { NoteRun, SyncMark } from './runTypes'
import { localEntry, putEntry, type RunEntries } from './sharedRuns'

/**
 * A shared note's results against the server's copy — ordered by the server alone (no computer's clock): each result
 * there has a revision, the server's number, given as it arrives. This device keeps, by entry, the revision it has
 * (received or taken) and, for its own result not sent yet, the revision it was run over. Sent — the server takes it
 * only when nothing newer came meanwhile (someone ran it while this device was offline, or a moment before): else the
 * newer one, the server's, is shown here. Kept with the note's runs: a restart neither sends old results again nor
 * forgets one made offline.
 */
export type SyncLedger = Record<string, SyncMark>

/**
 * This device's results now, marked: a new run of its own (another `at`) — to be sent over the revision known; an own
 * entry taken away here — to be taken away there. Returns whether anything was marked.
 */
export function markOwn(n: NoteRun, ledger: SyncLedger, now: RunEntries): boolean {
  let changed = false
  for (const [key, e] of Object.entries(now)) {
    const m = ledger[key]
    if (m?.own && m.at === e.at && !m.gone) continue
    ledger[key] = { rev: m?.rev ?? 0, at: e.at, own: true, pending: true }
    changed = true
  }
  // (one running again is not taken away: it is not among the ended ones only while it runs)
  for (const [key, m] of Object.entries(ledger))
    if (m.own && !m.gone && !(key in now) && !localEntry(n, key)) {
      ledger[key] = { ...m, pending: true, gone: true }
      changed = true
    }
  return changed
}

/** What to send: each own entry not taken yet — its value (taken away — null) over the revision it was made over. */
export function changesToSend(ledger: SyncLedger, now: RunEntries): ResultsPut['changes'] {
  const out: ResultsPut['changes'] = {}
  for (const [key, m] of Object.entries(ledger)) if (m.pending) out[key] = { value: m.gone ? null : (now[key]?.value ?? null), base: m.rev }
  return out
}

/** The server's answer: the taken ones — of that revision now; the others — what the server has is put in. */
export function settle(n: NoteRun, ledger: SyncLedger, reply: ResultsPutReply, me: string): boolean {
  let changed = false
  for (const [key, rev] of Object.entries(reply.accepted)) {
    const m = ledger[key]
    if (!m) continue
    ledger[key] = { rev, at: m.at, own: !m.gone, pending: false }
    changed = true
  }
  for (const [key, r] of Object.entries(reply.current)) changed = receive(n, ledger, key, r, me) || changed
  return changed
}

/**
 * A result of the server's put in (fetched, or the answer to a send): older than what is here — nothing; one's own
 * (another session, a restart) — known as taken; someone else's — shown (who ran it, the server's time); a run of
 * this device going on — left (its end is sent over this revision). Returns whether the note's runs changed.
 */
export function receive(n: NoteRun, ledger: SyncLedger, key: string, r: SharedResult, me: string): boolean {
  const m = ledger[key]
  if (m && r.seq <= m.rev) return false
  // this device runs it now: left as it is — its end goes over this revision
  if (localEntry(n, key)?.state === 'run') {
    ledger[key] = { rev: r.seq, at: m?.at ?? 0, own: false, pending: false }
    return true
  }
  if (r.device === me) {
    // one's own earlier result; a newer one of its own waiting to be sent — goes over it
    if (m?.pending && !m.gone) ledger[key] = { ...m, rev: r.seq }
    else {
      ledger[key] = { rev: r.seq, at: (r.value as { at?: number } | null)?.at ?? 0, own: r.value !== null, pending: false }
      putEntry(n, key, r.value)
    }
    return true
  }
  // someone else's (or taken away): as the server has it — newer than anything here; its time — the server's
  ledger[key] = { rev: r.seq, at: r.value === null ? 0 : r.at, own: false, pending: false }
  putEntry(n, key, r.value === null ? null : { ...(r.value as object), at: r.at }, r.by)
  return true
}
