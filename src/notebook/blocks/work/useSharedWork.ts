import { computed, watch, type Ref, type ShallowRef } from 'vue'
import type { KindDef } from '@shared/types'
import { noteRun, saveRunsSoon } from '@nb/engine/runStore'
import { sharedOfPath } from '@nb/workspace/sharedDocs'
import { useTransport } from '@renderer/lib/transport'
import type { WorkModel, WorkReport } from './model'

/** The owner's work as the others get it (with the note's run results): the report, the kinds and their counts. */
interface WorkShot {
  report: WorkReport
  kindCounts: Array<[string, number]>
  kinds: KindDef[]
}

/**
 * «Работа» in a shared note: the block is its owner's (the device that made it — marked in it); the owner's report goes
 * to the others with the run results, and they see it (whose — said), not their own work of the period.
 */
export function useSharedWork(o: {
  path: () => string
  line: () => number
  m: Ref<WorkModel>
  save: () => void
  report: ShallowRef<WorkReport | undefined>
  kindCounts: ShallowRef<Array<[string, number]>>
  kinds: ShallowRef<KindDef[]>
}) {
  const transport = useTransport()
  const shared = computed(() => (o.path() ? sharedOfPath(o.path()) : undefined))
  const me = computed(() => transport.value.deviceId)
  /** Someone else's block: their work is shown. */
  const foreign = computed(() => !!o.m.value.owner && !!me.value && o.m.value.owner !== me.value)
  const key = () => `_work${o.line()}`

  // a shared note's block with no owner yet: the one who has it open marks it as theirs
  watch(
    [shared, me],
    () => {
      if (!shared.value || !me.value || o.m.value.owner) return
      o.m.value.owner = me.value
      o.m.value.by = transport.value.name || undefined
      o.save()
    },
    { immediate: true },
  )
  // the owner's report published (when it changed)
  watch(
    [o.report, o.kindCounts, shared],
    () => {
      const r = o.report.value
      if (!shared.value || foreign.value || !r || !o.m.value.owner) return
      const used = new Set(o.kindCounts.value.map(([k]) => k))
      const shot: WorkShot = { report: r, kindCounts: o.kindCounts.value, kinds: o.kinds.value.filter((k) => used.has(k.id)) }
      const n = noteRun(o.path())
      if (JSON.stringify(n.runs[key()]?.value) === JSON.stringify(shot)) return
      n.runs[key()] = { state: 'ok', at: Date.now(), value: shot }
      saveRunsSoon(o.path())
    },
  )
  /** The owner's report as it came (someone else's block); none yet — undefined. */
  const theirs = computed<WorkShot | undefined>(() => (foreign.value ? (noteRun(o.path()).runs[key()]?.value as WorkShot | undefined) : undefined))
  return { foreign, theirs, ownerName: computed(() => o.m.value.by ?? 'другой участник') }
}
