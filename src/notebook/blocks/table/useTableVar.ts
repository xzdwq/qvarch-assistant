import { computed, ref, watch, type Ref } from 'vue'
import { isName } from '@nb/domain/blockInfo'
import { noteVarNames, TABLE_VAR_BASE, tableVars } from '@nb/domain/tableVars'
import { doc } from '@nb/workspace/noteDocs'
import type { TableModel } from './model'

/**
 * The table's variable in the note: its name (one given while the file has none — written with the next save), who
 * else holds it, renamed by the person (a name of a variable, not taken by another block or table).
 */
export function useTableVar(t: Ref<TableModel>, at: () => { path?: string; line?: number }) {
  /** What the note's text says of this table (its name given, a clash). */
  const inNote = computed(() => {
    const { path, line } = at()
    return path ? tableVars(doc(path).text).find((v) => v.line0 === line) : undefined
  })
  const name = computed(() => t.value.name ?? inNote.value?.name ?? TABLE_VAR_BASE)
  /** The name is another block's (or a table's above): the table is not published. */
  const clash = computed(() => (t.value.name === inNote.value?.name ? inNote.value?.clash : undefined))
  /** The given name kept in the file (before the table is saved — a name never moves once the table is edited). */
  function keepName(): void {
    if (!t.value.name) t.value.name = name.value
  }

  const draft = ref(name.value)
  watch(name, (n) => (draft.value = n))
  const error = ref('')
  /** The name typed taken (or why not: not a variable's name, held by another); false — not taken. */
  function rename(save: (now?: boolean) => void): boolean {
    const v = draft.value.trim()
    error.value = ''
    if (v === name.value) return (draft.value = v), true
    const { path } = at()
    const taken = path ? noteVarNames(doc(path).text) : new Set<string>()
    if (!isName(v)) error.value = 'Имя переменной: латиница, цифры и _, не с цифры и не служебное слово'
    else if (taken.has(v)) error.value = `Имя ${v} уже занято в заметке`
    if (error.value) return false
    t.value.name = v
    save(true)
    return true
  }
  /** The typed name dropped. */
  function revert(): void {
    draft.value = name.value
    error.value = ''
  }
  return { name, clash, keepName, draft, error, rename, revert }
}
