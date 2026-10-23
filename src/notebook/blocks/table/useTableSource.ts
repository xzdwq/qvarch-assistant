import { computed, onMounted, ref, watch, type Ref } from 'vue'
import { resolvePath } from '@nb/domain/values'
import { envAtLine, noteRun } from '@nb/engine'
import { doc } from '@nb/workspace/noteDocs'
import { fillFromValue, tableHash, textHash, type TableModel } from './model'

/**
 * «Из переменной»: the table filled from a value of the note (a query's rows, an answer's list, code's result);
 * edited as any table; while not edited — filled again when the value changes, edited — the person decides
 * («Обновить»); «Отделить» — a table of its own.
 */
export function useTableSource(t: Ref<TableModel>, save: (now?: boolean) => void, at: () => { path?: string; line?: number }, ownName: () => string) {
  /** The path reads the table's own variable (it would fill itself from itself). */
  const isOwn = (path: string) => /^[A-Za-z_$][\w$]*/.exec(path)?.[0] === ownName()
  /** The value the table is filled from (the note's — in a loop, the pass shown). */
  const source = computed(() => {
    const from = t.value.from
    const { path, line } = at()
    if (!from || !path || isOwn(from)) return undefined
    // (the env's values are read through Vue: the table follows them and the pass picked)
    return resolvePath(envAtLine(path, line ?? 0, doc(path).text).values(), from)
  })
  const sourceKey = computed(() => (source.value?.ok ? JSON.stringify(source.value.value) ?? '' : undefined))
  /** Edited since it was filled (a refill would lose the edits — asked first). */
  const edited = computed(() => !!t.value.from && t.value.filled !== tableHash(t.value))
  const stale = ref(false)
  function fill(): void {
    const v = source.value
    if (!v?.ok) return
    fillFromValue(t.value, v.value, sourceKey.value)
    stale.value = false
    save(true)
  }
  /**
   * The value changed (now, or while the table was off screen — its last value's hash kept with it): never filled yet,
   * or not edited since — filled now; edited — the person decides («Обновить»).
   */
  function follow(): void {
    const k = sourceKey.value
    if (k === undefined || (t.value.filled && t.value.srcHash === textHash(k))) return
    if (!t.value.filled || !edited.value) fill()
    else stale.value = true
  }
  watch(sourceKey, follow)
  // a table just made «from a value» — filled at once; one whose value changed while it was off screen — followed
  onMounted(() => t.value.from && follow())

  /** The type being chosen: the value's path asked for. */
  const asking = ref(false)
  const fromDraft = ref(t.value.from ?? '')
  function setFrom(path: string): void {
    const v = path.trim()
    asking.value = false
    if (!v || isOwn(v)) return
    t.value.from = v
    t.value.filled = undefined
    save(true)
    fill()
  }
  /** Cut off from its value: a table of its own, the data kept. */
  function detach(): void {
    t.value.from = undefined
    t.value.filled = undefined
    stale.value = false
    asking.value = false
    save(true)
  }
  /** The note's values to choose from (lists first — what a table most likely shows; not its own). */
  const varNames = computed(() => {
    const { path } = at()
    if (!path) return []
    const ctx = noteRun(path).ctx
    return Object.keys(ctx)
      .filter((k) => k !== ownName())
      .sort((a, b) => Number(Array.isArray(ctx[b].value)) - Number(Array.isArray(ctx[a].value)) || ctx[b].at - ctx[a].at)
  })
  return { source, edited, stale, fill, asking, fromDraft, setFrom, detach, varNames }
}
