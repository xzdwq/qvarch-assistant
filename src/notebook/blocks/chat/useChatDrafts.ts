import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { fileKindOf } from '@shared/transport/chat'
import { fileRefusal } from '@renderer/lib/chatFileView'

/** A file waiting to go with the next message; a picture — its preview. */
export interface ChatDraft {
  file: File
  url?: string
}

/**
 * The files of the message being written: pasted (a screenshot, copied files — copied text stays text), dropped,
 * picked; each shown under the input (a picture — as a picture) until it goes or is taken away. One too big — said.
 */
export function useChatDrafts() {
  const drafts = shallowRef<ChatDraft[]>([])
  const refused = ref('')
  const free = (d: ChatDraft) => d.url && URL.revokeObjectURL(d.url)

  function add(files: Iterable<File>): void {
    refused.value = ''
    const more: ChatDraft[] = []
    for (const file of files) {
      const no = fileRefusal(file)
      if (no) refused.value = no
      else more.push({ file, url: fileKindOf(file.type) === 'image' ? URL.createObjectURL(file) : undefined })
    }
    drafts.value = [...drafts.value, ...more]
  }
  function remove(d: ChatDraft): void {
    free(d)
    drafts.value = drafts.value.filter((x) => x !== d)
  }
  onBeforeUnmount(() => drafts.value.forEach(free))

  // (the chat stands in a note: its paste / drop are its own, not the note's)
  function onPaste(e: ClipboardEvent): void {
    const dt = e.clipboardData
    if (!dt || dt.getData('text/plain').trim() || !dt.files.length) return
    e.preventDefault()
    e.stopPropagation()
    add(dt.files)
  }
  function onDragOver(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
  }
  function onDrop(e: DragEvent): void {
    const files = e.dataTransfer?.files
    if (!files?.length) return
    e.preventDefault()
    e.stopPropagation()
    add(files)
  }
  return { drafts, refused, add, remove, onPaste, onDragOver, onDrop }
}
