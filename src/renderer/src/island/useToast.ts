import { ref } from 'vue'

/** A short message under the cut row: what was saved, or why not (it fades by itself). */
export function useToast(ms = 2600) {
  const toast = ref<{ text: string; ok: boolean }>()
  function flash(text: string, ok: boolean): void {
    toast.value = { text, ok }
    setTimeout(() => toast.value?.text === text && (toast.value = undefined), ms)
  }
  return { toast, flash }
}

/** What an Outlook meeting answers to any change. */
export const OUTLOOK_READONLY = 'Встреча из Outlook — её меняет только Outlook'
