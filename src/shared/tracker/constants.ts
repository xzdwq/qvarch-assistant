/**
 * The tracker's value sets: the built-in kinds, own-task keys, the report's task types, block origins,
 * groupings and chart units. Each set is written once; its union type is derived from it.
 */

/** The built-in kinds of activity (default settings; the user may add own ones, so an entry's kind is any string). */
export const BUILTIN_KINDS = ['task', 'call', 'meeting', 'break', 'lunch', 'other'] as const
export type BuiltinKind = (typeof BUILTIN_KINDS)[number]

export const isBuiltinKind = (id: string): id is BuiltinKind => (BUILTIN_KINDS as readonly string[]).includes(id)

/** An entry's kind is this built-in one (the literal is checked by the compiler; the id itself is any string). */
export const isKind = (id: string, kind: BuiltinKind): boolean => id === kind

/** The CSS colour of a built-in kind's default (a variable of the tracker's colours). */
export const kindColorVar = (kind: BuiltinKind): string => `var(--kind-${kind})`

/** What an audio note recorded: the user's voice, or a call (the other side's sound and the microphone). */
export const AUDIO_NOTE_KINDS = ['voice', 'call'] as const
export type AudioNoteKind = (typeof AUDIO_NOTE_KINDS)[number]

/** How each kind of recording is shown: its icon and name. */
export const AUDIO_NOTE_LOOK: Record<AudioNoteKind, { icon: string; label: string }> = {
  voice: { icon: 'mic', label: 'Голосовая заметка' },
  call: { icon: 'phone', label: 'Запись звонка' },
}

/** A note's icon: its recording's, else a plain note. */
export const noteIcon = (n: { audio?: { kind: AudioNoteKind } }): string => (n.audio ? AUDIO_NOTE_LOOK[n.audio.kind].icon : 'note')

/** What a block's time is on: a Jira task, an own task, none. */
export const TASK_TYPES = ['jira', 'own', 'none'] as const
export type TaskType = (typeof TASK_TYPES)[number]

/** Where a block came from: an Outlook meeting, a detected call, put by hand (AI included). */
export const ENTRY_ORIGINS = ['outlook', 'call', 'manual'] as const
export type EntryOrigin = (typeof ENTRY_ORIGINS)[number]

/** How a report groups its time. */
export const GROUP_BYS = ['kind', 'task', 'day', 'week'] as const
export type GroupBy = (typeof GROUP_BYS)[number]

/** The chart's bar: a day, a week, a month. */
export const CHART_UNITS = ['day', 'week', 'month'] as const
export type ChartUnit = (typeof CHART_UNITS)[number]

/** How each task type and origin is shown in filters and breakdowns (colours — the tracker's CSS variables). */
export const TASK_TYPE_LOOK: Record<TaskType, { label: string; color: string }> = {
  jira: { label: 'Jira', color: 'var(--report-task-jira)' },
  own: { label: 'Свои задачи', color: 'var(--report-task-own)' },
  none: { label: 'Без задачи', color: 'var(--report-task-none)' },
}
export const ORIGIN_LOOK: Record<EntryOrigin, { label: string; color: string }> = {
  outlook: { label: 'Outlook', color: 'var(--report-origin-outlook)' },
  call: { label: 'Найденные созвоны', color: 'var(--report-origin-call)' },
  manual: { label: 'Вручную', color: 'var(--report-origin-manual)' },
}
