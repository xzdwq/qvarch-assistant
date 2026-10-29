import { computed, reactive, ref, shallowReactive, watch } from 'vue'
import { DOCK_H, dockShown, termPlaceOf, type TermDockState, type TermPlace } from '@shared/terminalDock'

/**
 * The bottom panel of the terminal and where the one terminal is (shared/terminalDock): the panel's state, its height
 * and pinning kept; the places register their boxes — the terminal is moved into the one it is shown in.
 */
const KEEP = 'qa.termDock'
function kept(): { h: number; pinned: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(KEEP) ?? '{}') as { h?: unknown; pinned?: unknown }
    return { h: typeof v.h === 'number' ? v.h : DOCK_H.start, pinned: v.pinned === true }
  } catch {
    return { h: DOCK_H.start, pinned: false }
  }
}
const was = kept()
export const termDock = reactive<TermDockState & { pinned: boolean; h: number }>({ open: false, asked: 'section', sectionShown: false, pinned: was.pinned, h: was.h })
watch(
  () => [termDock.h, termDock.pinned],
  () => {
    try {
      localStorage.setItem(KEEP, JSON.stringify({ h: Math.round(termDock.h), pinned: termDock.pinned }))
    } catch {
      // kept for this run only
    }
  },
)

/** The panel on screen. */
export const dockOn = computed(() => dockShown(termDock))
/** The places' boxes (each registers its own while mounted). */
const slots = shallowReactive<Partial<Record<TermPlace, HTMLElement>>>({})
/** A place's box mounted (`el`) or gone (only that box — a newer one of the same place stays). */
export function termSlot(place: TermPlace, el: HTMLElement | undefined, gone?: HTMLElement): void {
  if (el) slots[place] = el
  else if (slots[place] === gone) delete slots[place]
}
/** The box the terminal is in now (its place not mounted — the panel's, hidden). */
export const termTarget = computed(() => slots[termPlaceOf(termDock)] ?? slots.dock)
/** Shown once — kept mounted from then on (its shells, its panes). */
export const termEver = ref(false)
watch([dockOn, () => termDock.sectionShown], ([d, s]) => (d || s) && (termEver.value = true))

/** The status line's button: the panel shown — hidden; else shown, the terminal moved into it. */
export function toggleDock(): void {
  if (dockOn.value) termDock.open = false
  else Object.assign(termDock, { open: true, asked: 'dock' })
}
/** The section shows the terminal again (it was in the panel). */
export const showInSection = (): void => void (termDock.asked = 'section')
/** Its section came on screen (it is asked there: a popped panel closes, a pinned one makes way) or went. */
export function setSectionShown(on: boolean): void {
  if (on && !termDock.sectionShown) Object.assign(termDock, { asked: 'section', open: termDock.open && termDock.pinned })
  termDock.sectionShown = on
}
