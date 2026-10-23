import { takeImages } from '@nb/workspace/noteMedia'
import type { Pane } from '@nb/workspace/paneLayout'
import type { NoteEditors } from './noteEditors'

/** Pictures into a note by the button (a file picker); a paste / a drop is the editor's own. */
export function useImagePicker(say: (t: string) => void, editors: NoteEditors) {
  /** The hidden file field (set by the screen). */
  let input: HTMLInputElement | null = null
  const setImageInput = (el: unknown) => (input = (el as HTMLInputElement | null) ?? null)
  /** The pane the pictures go to. */
  let target: Pane | undefined
  function pickImages(p: Pane): void {
    target = p
    if (!input) return
    input.value = ''
    input.click()
  }
  async function onImagesPicked(): Promise<void> {
    const files = [...(input?.files ?? [])]
    const p = target
    target = undefined
    if (!files.length || !p) return
    const rels = await takeImages({ files }, say)
    editors.of(p)?.insertImages(rels)
  }
  return { setImageInput, pickImages, onImagesPicked }
}
