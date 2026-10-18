<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { languageOf } from '../lib/codeLang'

/** A code field (CodeMirror): JS / JSON / SQL / XML / YAML… or plain text, the app's colours, Tab indents. */
const props = withDefaults(defineProps<{ modelValue: string; lang?: string; placeholder?: string; readonly?: boolean; minHeight?: number; fill?: boolean }>(), { lang: 'text', minHeight: 120 })
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()
const host = ref<HTMLElement>()
let view: EditorView | undefined
const langC = new Compartment()
/** The language put in when loaded (a later choice wins over a slow earlier one). */
let langSeq = 0
async function setLang(l: string): Promise<void> {
  const my = ++langSeq
  const ext = await languageOf(l)
  if (my === langSeq) view?.dispatch({ effects: langC.reconfigure(ext) })
}
const theme = EditorView.theme(
  {
    '&': { color: 'var(--text)', backgroundColor: 'var(--field-bg)', fontSize: '12.5px', border: '1px solid var(--border-2)', borderRadius: 'var(--r2)' },
    '&.cm-focused': { outline: 'none', borderColor: 'var(--accent)' },
    '.cm-content': { fontFamily: 'var(--font-data)', caretColor: 'var(--accent-fg)' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--dim)' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muted)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgb(var(--accent-rgb) / 0.3) !important' },
    '.cm-cursor': { borderLeftColor: 'var(--accent-fg)' },
    '.cm-tooltip': { background: 'var(--pop)', border: '1px solid var(--border-2)' },
    '.cm-scroller': { minHeight: `${props.minHeight}px` },
  },
  { dark: true },
)
onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        langC.of([]),
        theme,
        ...(props.placeholder ? [cmPlaceholder(props.placeholder)] : []),
        EditorState.readOnly.of(!!props.readonly),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => u.docChanged && emit('update:modelValue', u.state.doc.toString())),
      ],
    }),
  })
  void setLang(props.lang)
})
// changed from outside (another request opened, «Форматировать»)
watch(
  () => props.modelValue,
  (v) => {
    if (view && v !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
  },
)
watch(
  () => props.lang,
  (l) => void setLang(l),
)
onBeforeUnmount(() => view?.destroy())
</script>

<template>
  <div ref="host" class="ca" :class="{ fill }"></div>
</template>

<style scoped>
.ca {
  min-width: 0;
}
.ca :deep(.cm-editor) {
  max-height: 100%;
}
/* fill: as tall as its box, scrolling inside */
.ca.fill {
  height: 100%;
}
.ca.fill :deep(.cm-editor) {
  height: 100%;
}
</style>
