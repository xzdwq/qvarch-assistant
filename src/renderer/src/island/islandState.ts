import { inject, provide, watch, type InjectionKey } from 'vue'
import { islandElements } from './islandElements'
import { useDayList } from './useDayList'
import { useEntryEdit } from './useEntryEdit'
import { useIslandCut } from './useIslandCut'
import { useIslandDay } from './useIslandDay'
import { useIslandExpand } from './useIslandExpand'
import { useIslandLayout } from './useIslandLayout'
import { useIslandMenu } from './useIslandMenu'
import { useIslandSelection } from './useIslandSelection'
import { useIslandSettings } from './useIslandSettings'
import { useIslandTrack } from './useIslandTrack'
import { useQuickEvent } from './useQuickEvent'
import { useQuickNote } from './useQuickNote'
import { useToast } from './useToast'
import { useTrackPointer } from './useTrackPointer'
import { useTypingCombo } from './useTypingCombo'

/**
 * The island's state, built once by Island.vue and shared with its parts: each concern is its own composable,
 * wired here (later parts reach earlier ones directly, earlier ones reach later ones through lazy hooks).
 */
function createIslandState() {
  const els = islandElements()
  const island = useIslandSettings()
  const day = useIslandDay(island)
  const typingCombo = useTypingCombo(island)
  const { toast, flash } = useToast()
  const pick = useIslandSelection(day, {
    isEditing: (id) => edit.edit.value?.id === id,
    continueFrom: (e) => cut.copyFrom(e),
  })
  const expand = useIslandExpand(els, {
    isNoteOpen: () => quick.noteOpen.value,
    isMenuOpen: () => !!menu.menu.value,
    onCollapse: () => {
      pick.entryId.value = undefined
      menu.menu.value = undefined
    },
    onExpand: () => void island.loadSettings(),
  })
  const quick = useQuickNote(els, day, island, { cancelExpand: expand.cancelExpand })
  const quickEvent = useQuickEvent(day.today, quick.qMsg)
  const layout = useIslandLayout(els, island, day, expand, quick.noteOpen)
  const track = useIslandTrack(day)
  const pointer = useTrackPointer(els, day, track, pick)
  const cut = useIslandCut(els, day, pick, flash)
  const edit = useEntryEdit(day, pick, track.laneOf, flash)
  const menu = useIslandMenu(els, { island, day, pick, pointer, cut, edit, flash })
  const list = useDayList(day)

  // the pin state is read once — later reloads (on every expand) must not overwrite a click in flight
  void island.loadSettings().then(() => {
    expand.pinned.value = !!island.settings.value?.island.pinned
    if (expand.pinned.value) expand.setExpanded(true)
  })

  // the pill content lives in a <Transition> slot (re-rendered by the transition, not by its parent):
  // re-measure after anything that changes its width
  watch(
    () => [day.chips.value, day.pillInfo.value, day.status.value.text, pick.marker.value, expand.expanded.value, typingCombo.typing.value, island.ui.value],
    layout.measurePill,
    { flush: 'post' },
  )

  /** Escape closes the innermost thing open; with nothing open it collapses the island. */
  const escapeLadder: Array<[isOpen: () => boolean, close: () => void]> = [
    [() => !!pick.panelNote.value, () => (pick.panelNote.value = undefined)], // the editor saves on its way out
    [() => !!menu.menu.value, () => (menu.menu.value = undefined)],
    [() => !!edit.edit.value, () => (edit.edit.value = undefined)],
    [() => pick.multi.value.size > 0, () => (pick.multi.value = new Set())],
    [
      () => !!pick.entryId.value || pick.pinT.value !== undefined,
      () => {
        pick.entryId.value = undefined
        pick.pinT.value = undefined
      },
    ],
    [() => !!pick.marker.value, () => pick.sel.clear()],
    [() => true, expand.collapse],
  ]
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') escapeLadder.find(([isOpen]) => isOpen())?.[1]()
  }

  /** Opens the main window (on a block). */
  const openMain = (entryId?: string) => window.qa.openMain(undefined, entryId)

  return { els, island, day, typingCombo, toast, flash, pick, expand, quick, quickEvent, layout, track, pointer, cut, edit, menu, list, onKey, openMain }
}

export type IslandState = ReturnType<typeof createIslandState>
const ISLAND: InjectionKey<IslandState> = Symbol('island')

/** Builds the island's state and shares it with the parts (Island.vue only). */
export function provideIsland(): IslandState {
  const state = createIslandState()
  provide(ISLAND, state)
  return state
}

/** The island's state inside one of its parts. */
export function useIsland(): IslandState {
  const state = inject(ISLAND)
  if (!state) throw new Error('useIsland() outside Island.vue')
  return state
}
