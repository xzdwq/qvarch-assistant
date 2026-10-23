import { describe, expect, it } from 'vitest'
import { DEFAULT_KINDS, findKind, isProductive } from '../../src/shared/kinds'
import { AUDIO_NOTE_KINDS, AUDIO_NOTE_LOOK, BUILTIN_KINDS, isBuiltinKind, isKind, kindColorVar, noteIcon } from '../../src/shared/tracker/constants'
import { toVaultEntryKind, VAULT_ENTRY_KINDS } from '../../src/shared/vault'
import { JIRA_STATUS_CATEGORIES } from '../../src/shared/jira'
import { CONTRASTS } from '../../src/shared/theme'
import { bars, groupItems, groupKey, sourceOf, taskType, type ReportItem } from '../../src/shared/report'
import { REPEAT_RULES, shiftBy } from '../../src/shared/repeat'
import { clampPrefs, comboOf, isModifiersOnly, isQuarterTurn, rotate, type TabletRotation } from '../../src/shared/tablet'
import { orbMood } from '../../src/shared/tracker/islandPill'
import { seriesScheme } from '../../src/shared/tracker/reportChart'
import { dayStart, HOUR } from '../../src/shared/timeline'
import type { Entry } from '../../src/shared/types'

describe('built-in kinds', () => {
  it('the defaults: one per built-in kind, coloured by the theme', () => {
    expect(DEFAULT_KINDS.map((k) => k.id)).toEqual([...BUILTIN_KINDS])
    expect(DEFAULT_KINDS.find((k) => k.id === 'call')).toMatchObject({ label: 'Созвон', icon: 'phone', productive: true, color: 'var(--kind-call)' })
    expect(findKind(DEFAULT_KINDS, 'gone')).toEqual({ id: 'gone', label: 'gone', color: kindColorVar('other'), icon: 'tag' })
  })
  it('work: by the setting, else breaks and lunch are not', () => {
    expect(isProductive([], 'lunch')).toBe(false)
    expect(isProductive([], 'break')).toBe(false)
    expect(isProductive([], 'review')).toBe(true)
    expect(isProductive([], 'constructor')).toBe(true)
    expect(isProductive([{ id: 'lunch', label: '', color: '', icon: '', productive: true }], 'lunch')).toBe(true)
  })
  it('a kind id against a built-in one', () => {
    expect(isKind('call', 'call')).toBe(true)
    expect(isKind('calls', 'call')).toBe(false)
    expect([isBuiltinKind('meeting'), isBuiltinKind('toString')]).toEqual([true, false])
  })
})

describe('audio notes', () => {
  it('each kind of recording has its look; a note without one — a plain note icon', () => {
    expect(AUDIO_NOTE_KINDS.map((k) => AUDIO_NOTE_LOOK[k].icon)).toEqual(['mic', 'phone'])
    expect([noteIcon({}), noteIcon({ audio: { kind: 'voice' } }), noteIcon({ audio: { kind: 'call' } })]).toEqual(['note', 'mic', 'phone'])
  })
})

describe('vault entries, Jira categories, contrasts', () => {
  it('an entry kind from outside: a known one as is, anything else — a note', () => {
    expect(VAULT_ENTRY_KINDS.map(toVaultEntryKind)).toEqual([...VAULT_ENTRY_KINDS])
    expect([toVaultEntryKind('file'), toVaultEntryKind(undefined), toVaultEntryKind(1)]).toEqual(['note', 'note', 'note'])
  })
  it('the lists keep their order', () => {
    expect(JIRA_STATUS_CATEGORIES).toEqual(['new', 'indeterminate', 'done'])
    expect(CONTRASTS).toEqual(['soft', 'normal', 'high'])
  })
})

const d0 = dayStart('2026-10-12')
const item = (day: string, kind: string, extra: Partial<Entry> = {}): ReportItem => {
  const s = dayStart(day) + 9 * HOUR
  return { day, e: { id: `${day}${kind}`, start: s, end: s + HOUR, kind, label: '', source: 'manual', ...extra } }
}

describe('report groupings', () => {
  it('a group key per grouping', () => {
    const it2 = item('2026-10-14', 'call', { task: { key: 'A-1', summary: '' } })
    expect([groupKey(it2, 'kind'), groupKey(it2, 'task'), groupKey(it2, 'day'), groupKey(it2, 'week')]).toEqual(['call', 'A-1', '2026-10-14', '2026-10-12'])
    expect(groupKey(item('2026-10-14', 'call'), 'task')).toBe('')
  })
  it('periods in time order, the rest by size', () => {
    const items = [item('2026-10-14', 'task'), item('2026-10-12', 'call'), item('2026-10-13', 'call')]
    expect(groupItems(items, 'day').map((g) => g.key)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14'])
    expect(groupItems(items, 'kind').map((g) => g.key)).toEqual(['call', 'task'])
  })
  it('bars by day, week, month', () => {
    const items = [item('2026-10-12', 'task'), item('2026-10-20', 'task')]
    const days = ['2026-10-12', '2026-10-20']
    expect(bars(items, days, 'day', () => 's').map((b) => b.key)).toEqual(days)
    expect(bars(items, days, 'week', () => 's').map((b) => b.key)).toEqual(['2026-10-12', '2026-10-19'])
    expect(bars(items, days, 'month', () => 's').map((b) => b.key)).toEqual(['2026-10'])
  })
  it('task type and origin', () => {
    expect([taskType({}), taskType({ task: { key: 'Q-2' } }), taskType({ task: { key: 'AB-2' } })]).toEqual(['none', 'own', 'jira'])
    const e = item('2026-10-12', 'call').e
    expect([sourceOf(e), sourceOf({ ...e, source: 'detected' }), sourceOf({ ...e, outlook: { id: 'x', sig: '' } })]).toEqual(['manual', 'call', 'outlook'])
  })
  it('task series colours: the theme variables, the extras by their look', () => {
    const sc = seriesScheme('task', ['A-1', 'B-1'], { label: (k) => k, color: (k) => k })
    expect([sc.color('A-1'), sc.color('B-1'), sc.color(''), sc.color('*')]).toEqual(['var(--report-series-1)', 'var(--report-series-2)', 'var(--report-task-none)', 'var(--report-series-rest)'])
  })
})

describe('repeats', () => {
  it('each rule steps its own way', () => {
    expect(REPEAT_RULES.map((r) => [r.id, r.count])).toEqual([['hour', 8], ['day', 10], ['week', 8], ['year', 3]])
    const t = d0 + 10 * HOUR
    expect(shiftBy(t, 'hour', 2)).toBe(t + 2 * HOUR)
    expect(new Date(shiftBy(t, 'day', 3)).getDate()).toBe(15)
    expect(new Date(shiftBy(t, 'week', 1)).getDate()).toBe(19)
    expect(new Date(shiftBy(t, 'year', 1)).getFullYear()).toBe(2027)
    expect(new Date(shiftBy(t, 'day', 3)).getHours()).toBe(10)
  })
})

describe('tablet tables', () => {
  it('rotations', () => {
    const r: Array<[TabletRotation, [number, number]]> = [[0, [0.2, 0.3]], [90, [0.7, 0.2]], [180, [0.8, 0.7]], [270, [0.3, 0.8]]]
    for (const [rot, out] of r) expect(rotate(0.2, 0.3, rot)).toEqual(out)
    expect([0, 90, 180, 270].map((x) => isQuarterTurn(x as TabletRotation))).toEqual([false, true, false, true])
  })
  it('targets: a known kind kept, a monitor keeps its name, anything else — the primary monitor', () => {
    expect(clampPrefs({ target: { kind: 'canvas' } }).target).toEqual({ kind: 'canvas' })
    expect(clampPrefs({ target: { kind: 'monitor', name: 'X' } }).target).toEqual({ kind: 'monitor', name: 'X' })
    expect(clampPrefs({ target: { kind: 'tv' } as never }).target).toEqual({ kind: 'monitor', name: undefined })
  })
  it('key names: digits, F-keys, named keys; modifiers alone', () => {
    const k = (code: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) => comboOf({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods })
    expect([k('Digit7'), k('F12'), k('NumpadEnter'), k('Backslash'), k('Unknown')]).toEqual(['7', 'F12', 'Enter', '\\', ''])
    expect(k('MetaLeft', { metaKey: true, ctrlKey: true })).toBe('Ctrl+Win')
    expect([isModifiersOnly('Ctrl+Shift'), isModifiersOnly('Alt'), isModifiersOnly('Ctrl+Z'), isModifiersOnly('')]).toEqual([true, true, false, false])
  })
})

describe('orb moods', () => {
  it('a tint variable per mood, the first signal wins', () => {
    const base = { recording: false, transcribing: false, noteOpen: false, inCall: false, dayFilled: false, offHours: false }
    expect(orbMood(base)).toMatchObject({ state: 'working', tint: '--orb-working' })
    expect(orbMood({ ...base, transcribing: true, inCall: true })).toMatchObject({ state: 'solving', tint: '--orb-transcribing', speed: 1.8 })
    expect(orbMood({ ...base, inCall: true })).toMatchObject({ state: 'listening', tint: '--orb-call' })
  })
})
