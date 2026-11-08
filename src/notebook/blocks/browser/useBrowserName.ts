import { ref, watch, type ComputedRef } from 'vue'
import { isName, type BlockInfo } from '@nb/domain/blockInfo'
import { doc, setText } from '@nb/workspace/noteDocs'
import { nameTakenIn, renameBrowserIn } from './model'

const JS_NAME = /^[A-Za-z_$][\w$]*$/

/**
 * A note's browser's name — what the note's Playwright blocks pick it by (in=…): typed, checked (a JS name, not taken
 * in the note), written — the blocks that run in it renamed too. `own` — its own line renamed when the note's text
 * has it elsewhere (the block's line moved meanwhile).
 */
export function useBrowserName(props: { path: string; line: number }, info: ComputedRef<BlockInfo>, own: (name: string) => void) {
  const draft = ref(info.value.name ?? '')
  const bad = ref('')
  watch(
    () => info.value.name,
    (n) => ((draft.value = n ?? ''), (bad.value = '')),
  )
  function commit(): void {
    const to = draft.value.trim()
    const from = info.value.name
    bad.value = ''
    if (to === (from ?? '')) return
    if (!JS_NAME.test(to)) return void (bad.value = 'Имя — латиница, цифры и _, начиная с буквы')
    // (page, browser, context… — the scenario's own objects)
    if (!isName(to)) return void (bad.value = `«${to}» занято сценарием Playwright — выберите другое (например, ${to}1)`)
    const text = doc(props.path).text
    if (nameTakenIn(text, to, props.line)) return void (bad.value = `«${to}» уже есть в заметке`)
    const next = renameBrowserIn(text, props.line, from, to)
    if (next !== undefined) setText(props.path, next)
    else own(to)
  }
  /** The typed name given up (Esc). */
  function cancel(): void {
    draft.value = info.value.name ?? ''
    bad.value = ''
  }
  return { draft, bad, commit, cancel }
}
