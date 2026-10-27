import { inject, provide, ref, type InjectionKey } from 'vue'
import { NoteEditors } from './noteEditors'
import { useTreeEditing } from './useTreeEditing'
import { useVaultActions } from './useVaultActions'
import { useDocTransfer } from './useDocTransfer'
import { useNoteVoice } from './useNoteVoice'
import { useVaultSearch } from './useVaultSearch'
import { useTabDrag } from './useTabDrag'
import { useNoteEvents } from './useNoteEvents'
import { useVarsPanel } from './useVarsPanel'
import { useTreeMenu } from './useTreeMenu'
import { useNotebookKeys } from './useNotebookKeys'
import { useImagePicker } from './useImagePicker'

/** A word for a moment at the bottom of the notes (an error, «exported»…). */
function useToast() {
  const msg = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined
  function say(t: string): void {
    msg.value = t
    clearTimeout(timer)
    timer = setTimeout(() => (msg.value = ''), 4000)
  }
  return { msg, say }
}

/**
 * The notes screen's state and actions, made once by NotebookView and shared with its parts (the side, the panes,
 * the menus) — the vault's state itself lives in @nb/workspace.
 */
function createNotebookScreen() {
  const toast = useToast()
  const editors = new NoteEditors()
  const editing = useTreeEditing()
  const actions = useVaultActions(toast.say, editing, editors)
  const transfer = useDocTransfer(toast.say, editing.focus)
  const voice = useNoteVoice(toast.say, editors)
  const search = useVaultSearch(editors)
  const tabs = useTabDrag()
  const events = useNoteEvents(editors)
  const vars = useVarsPanel()
  const menu = useTreeMenu(editing.focus)
  const images = useImagePicker(toast.say, editors)
  useNotebookKeys({ newNote: () => actions.newNote(), openSearch: () => search.toggleSearch(true) })
  /** What a board says about itself (shown in its status line), by path. */
  const boardInfo = ref<Record<string, string>>({})
  /** «Инструкция» (the notebook's and the testing tools' help) open. */
  const helpOpen = ref(false)
  return { toast, editors, editing, actions, transfer, voice, search, tabs, events, vars, menu, images, boardInfo, helpOpen }
}
export type NotebookScreen = ReturnType<typeof createNotebookScreen>

const SCREEN: InjectionKey<NotebookScreen> = Symbol('notebookScreen')
/** Made by the screen (NotebookView) for its parts. */
export function provideNotebookScreen(): NotebookScreen {
  const s = createNotebookScreen()
  provide(SCREEN, s)
  return s
}
/** The screen's state in one of its parts. */
export function useNotebookScreen(): NotebookScreen {
  const s = inject(SCREEN)
  if (!s) throw new Error('useNotebookScreen() outside the notes screen')
  return s
}
