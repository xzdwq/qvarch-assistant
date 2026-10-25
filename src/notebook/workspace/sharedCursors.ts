import { reactive } from 'vue'
import type { DeviceInfo } from '@shared/transport/protocol'
import type { PeerSel } from '@shared/transport/sharedText'
import { onServerEvents } from '@renderer/lib/serverEvents'
import { serverCall, serverOnline } from '@renderer/lib/transport'
import { sharedDocOfPath, sharedOfPath, sharedTick } from './sharedDocs'
import { rangeFor, selFor } from './sharedPlaces'

/**
 * The participants' cursors in a shared note: this device's told to the others (moving — a few times a second; typing —
 * once it pauses: a cursor is a place that follows the text, it moves with every edit by itself), theirs shown where
 * they are now. Never kept: one who leaves the note — their cursor goes.
 */
const MOVE_MS = 120
const TYPED_MS = 450

interface Peer {
  device: DeviceInfo
  sel: PeerSel
  /** When it last moved here (its name shows for a moment then). */
  moved: number
}
/** Each document's others' cursors, by device. */
const peers = reactive(new Map<string, Map<string, Peer>>())
onServerEvents({
  'doc.cursor': (p) => {
    const m = peers.get(p.doc) ?? new Map<string, Peer>()
    if (p.sel) m.set(p.device.id, { device: p.device, sel: p.sel, moved: Date.now() })
    else m.delete(p.device.id)
    peers.set(p.doc, m)
  },
  // one no longer there — their cursor goes (a connection dropped too)
  'doc.presence': (p) => {
    const m = peers.get(p.doc)
    if (m) for (const id of [...m.keys()]) if (!p.devices.some((d) => d.id === id)) m.delete(id)
  },
})

/** A cursor as the editor draws it: whose, the selection, the caret, when it last moved. */
export interface PeerCursor {
  id: string
  name: string
  from: number
  to: number
  head: number
  moved: number
}
/** The others' cursors in a note where they are now (they follow every edit). */
export function peerCursorsIn(path: string): PeerCursor[] {
  void sharedTick.n
  const m = peers.get(sharedDocOfPath(path))
  if (!m?.size) return []
  return [...m.values()]
    .sort((a, b) => a.device.id.localeCompare(b.device.id))
    .flatMap((p) => {
      const r = rangeFor(path, p.sel)
      if (!r) return []
      // its selection's text gone (deleted, typed over) — just the caret where it was
      if (r.gone) return [{ id: p.device.id, name: p.device.name, from: r.from, to: r.from, head: r.from, moved: p.moved }]
      return [{ id: p.device.id, name: p.device.name, from: r.from, to: r.to, head: p.sel.caretAtStart ? r.from : r.to, moved: p.moved }]
    })
}

// ---------- this device's cursor ----------
const outgoing = new Map<string, { anchor: number; head: number; timer?: ReturnType<typeof setTimeout>; last: number; sent?: string }>()
/** This person's cursor in a note moved (`typed` — by typing): told to the others, not too often. */
export function tellCursor(path: string, anchor: number, head: number, typed: boolean): void {
  if (!serverOnline.value || !sharedOfPath(path)) return
  const o = outgoing.get(path) ?? outgoing.set(path, { anchor, head, last: 0 }).get(path)!
  o.anchor = anchor
  o.head = head
  clearTimeout(o.timer)
  const wait = typed ? TYPED_MS : Math.max(0, o.last + MOVE_MS - Date.now())
  o.timer = setTimeout(() => sendCursor(path), wait)
}
function sendCursor(path: string): void {
  const o = outgoing.get(path)
  const sh = sharedOfPath(path)
  const sel = o && selFor(path, o.anchor, o.head)
  if (!o || !sh || !sel || !serverOnline.value) return
  const key = JSON.stringify(sel)
  if (key === o.sent) return
  o.sent = key
  o.last = Date.now()
  void serverCall('doc.cursor', { doc: sh.doc, sel }).catch(() => (o.sent = undefined))
}
