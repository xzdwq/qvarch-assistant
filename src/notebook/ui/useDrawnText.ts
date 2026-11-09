import { computed, nextTick, ref, type Ref } from 'vue'

/**
 * A component's text (a callout's, a toggle's) drawn as Markdown — code, bold, links, lists, wiki links: as the note's
 * own text and the editors around show it — until it is edited: a press on it (or an arrow from the title) opens its
 * field, leaving the field — drawn again. An empty one shows its field (its hint). A link pressed opens, not edited.
 */
export function useDrawnText(text: () => string, field: Ref<HTMLTextAreaElement | undefined>, left: () => void) {
  const editing = ref(false)
  const drawn = computed(() => !editing.value && !!text().trim())
  /** The field opened and focused. */
  async function edit(): Promise<void> {
    editing.value = true
    await nextTick()
    field.value?.focus()
  }
  /** A press on the drawn text: edited — a link pressed opens instead. */
  function onDrawnDown(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('a')) return
    e.preventDefault()
    void edit()
  }
  /** The field left: what was typed kept, the text drawn again. */
  function leave(): void {
    left()
    editing.value = false
  }
  return { editing, drawn, edit, onDrawnDown, leave }
}
