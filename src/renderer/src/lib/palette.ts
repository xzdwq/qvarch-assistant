import { shallowRef } from 'vue'
import { DEFAULT_KINDS, findKind } from '@shared/kinds'
import type { AppKind, KindDef } from '@shared/types'

/** Kinds of activity from settings (user-editable); every window keeps its own reactive copy. */
export const kinds = shallowRef<KindDef[]>(DEFAULT_KINDS)

export function setKinds(list: KindDef[] | undefined): void {
  if (list?.length) kinds.value = list
}

let loaded = false
/** Loads kinds once per window; call again with `force` after settings change. */
export function loadKinds(force = false): void {
  if (loaded && !force) return
  loaded = true
  void window.qa.getSettings().then((s) => setKinds(s.kinds))
}

export function kindColor(kind: string): string {
  return findKind(kinds.value, kind).color
}

export function kindLabel(kind: string): string {
  return findKind(kinds.value, kind).label
}

export function kindIcon(kind: string): string {
  return findKind(kinds.value, kind).icon
}


export const APP_COLORS: Record<AppKind, string> = {
  ide: '#818cf8',
  browser: '#38bdf8',
  teams: '#a78bfa',
  mail: '#60a5fa',
  terminal: '#4ade80',
  office: '#22d3ee',
  chat: '#f472b6',
  other: '#a1a1aa',
  idle: '#3f3f46',
  locked: '#27272a',
}

/** The icon of a block: an Outlook meeting, a task (Jira / own), or its kind. */
export function entryIcon(e: { kind: string; task?: { key: string }; outlook?: unknown }): string {
  // an own task (Q-n) — the checkbox; a Jira issue — its mark
  return e.outlook ? 'outlook' : e.task ? (e.task.key.startsWith('Q-') ? 'checkSquare' : 'jira') : kindIcon(e.kind)
}
