import type { Entry } from '../types'

/**
 * Attributes of events: the person's own lists («Проект»: Альфа, Бета…) — an event takes one value of each.
 * Shown compactly (a few letters in the attribute's colour), counted in the reports (a filter, a breakdown, the
 * chart's colours). An attribute turned off is not offered for new events — the ones that have it keep showing it;
 * one deleted takes its values off every event (as does a value taken out of its list).
 */

export interface AttrOption {
  id: string
  label: string
}
export interface AttrDef {
  id: string
  name: string
  /** Its letters on an event (up to ATTR_SHORT_MAX). */
  short: string
  color: string
  /** Offered for new events (off — kept on the events that have it, not offered). */
  active: boolean
  options: AttrOption[]
}
/** An event's values: attribute id → option id. */
export type EntryAttrs = Record<string, string>

export const ATTR_SHORT_MAX = 3
/** An attribute's letters made from its name. */
export const autoShort = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, ATTR_SHORT_MAX).toUpperCase() || '?'
/** The letters as typed (up to three, capital), none — from the name. */
export const cleanShort = (short: string, name: string) => short.replace(/\s/g, '').slice(0, ATTR_SHORT_MAX).toUpperCase() || autoShort(name)

/** «No value» of an attribute (a filter / a breakdown row). */
export const NO_VALUE = ''
export const NO_VALUE_LABEL = 'Без значения'
/** An event's value of an attribute ('' — none). */
export const attrValue = (e: { attrs?: EntryAttrs }, id: string): string => e.attrs?.[id] ?? NO_VALUE
/** An option's label ('' — «Без значения»; a value no longer in the list — as it is). */
export function optionLabel(def: AttrDef | undefined, value: string): string {
  if (value === NO_VALUE) return NO_VALUE_LABEL
  return def?.options.find((o) => o.id === value)?.label ?? value
}

/** What the event's card offers: the active attributes and any the event has a value of (kept though turned off). */
export const offeredAttrs = (defs: readonly AttrDef[], attrs?: EntryAttrs) => defs.filter((d) => d.active || !!attrs?.[d.id])

/** An event's values as chips: the value's letters (up to three) in the attribute's colour; the names — in full. */
export interface AttrChip {
  id: string
  /** The value's letters, shown on the chip. */
  short: string
  name: string
  value: string
  color: string
}
export function attrChips(defs: readonly AttrDef[], attrs?: EntryAttrs): AttrChip[] {
  if (!attrs) return []
  return defs.flatMap((d) => {
    if (!attrs[d.id]) return []
    const value = optionLabel(d, attrs[d.id])
    return [{ id: d.id, short: autoShort(value), name: d.name, value, color: d.color }]
  })
}
/** The chips' tooltip: «Проект: Альфа» a line each. */
export const chipsTitle = (chips: readonly AttrChip[]) => chips.map((c) => `${c.name}: ${c.value}`).join('\n')

// ---------- the settings changed: what goes off the events ----------
/** What a change of the attributes takes off the events: a deleted attribute — all of it; a value out of the list — that value. */
export function attrRemovals(prev: readonly AttrDef[], next: readonly AttrDef[]): Map<string, 'all' | Set<string>> {
  const out = new Map<string, 'all' | Set<string>>()
  for (const p of prev) {
    const n = next.find((x) => x.id === p.id)
    if (!n) {
      out.set(p.id, 'all')
      continue
    }
    const gone = new Set(p.options.filter((o) => !n.options.some((x) => x.id === o.id)).map((o) => o.id))
    if (gone.size) out.set(p.id, gone)
  }
  return out
}
/** An event without what was taken away (undefined — nothing to take: the event is as it was). */
export function withoutRemoved(e: Entry, removals: Map<string, 'all' | Set<string>>): Entry | undefined {
  if (!e.attrs) return undefined
  const attrs: EntryAttrs = {}
  let changed = false
  for (const [id, v] of Object.entries(e.attrs)) {
    const r = removals.get(id)
    if (r === 'all' || r?.has(v)) changed = true
    else attrs[id] = v
  }
  if (!changed) return undefined
  const { attrs: _old, ...rest } = e
  return Object.keys(attrs).length ? { ...rest, attrs } : rest
}

/** Attributes as stored settings: each with a name, its letters, a value list without blanks (ids kept). */
export function cleanAttrs(v: unknown): AttrDef[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((a: Partial<AttrDef>) => {
    if (!a || typeof a.id !== 'string' || typeof a.name !== 'string' || !a.name.trim()) return []
    const options = (Array.isArray(a.options) ? a.options : []).filter((o): o is AttrOption => !!o && typeof o.id === 'string' && typeof o.label === 'string' && !!o.label.trim()).map((o) => ({ id: o.id, label: o.label.trim() }))
    return [{ id: a.id, name: a.name.trim(), short: cleanShort(typeof a.short === 'string' ? a.short : '', a.name), color: typeof a.color === 'string' ? a.color : '#888888', active: a.active !== false, options }]
  })
}

// ---------- in the reports: a dimension per attribute ----------
/** A report's grouping / chart colouring by an attribute. */
export type AttrDimension = `attr:${string}`
export const attrDim = (id: string): AttrDimension => `attr:${id}`
export const attrOfDim = (d: string): string | undefined => (d.startsWith('attr:') ? d.slice(5) : undefined)
/** An option's colour in a chart / a breakdown: the attribute's colour, fainter down the list; no value — grey. */
export function optionColor(def: AttrDef | undefined, value: string): string {
  if (!def || value === NO_VALUE) return 'var(--report-series-rest)'
  const i = Math.max(0, def.options.findIndex((o) => o.id === value))
  return `color-mix(in srgb, ${def.color} ${Math.max(35, 100 - i * 15)}%, transparent)`
}
