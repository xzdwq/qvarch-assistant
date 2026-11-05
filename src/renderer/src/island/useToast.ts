import { useFlash } from '../lib/useFlash'

/** A short message under the cut row: what was saved, or why not (it fades by itself). */
export function useToast(ms = 2600) {
  const { shown: toast, flash: show } = useFlash<{ text: string; ok: boolean }>(ms)
  const flash = (text: string, ok: boolean): void => show({ text, ok })
  return { toast, flash }
}

/** What an Outlook meeting answers to any change. */
export const OUTLOOK_READONLY = 'Встреча из Outlook — её меняет только Outlook'
