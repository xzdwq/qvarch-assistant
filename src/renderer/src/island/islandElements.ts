import { ref } from 'vue'
import type QuickField from '../components/QuickField.vue'

/**
 * The island's elements the logic measures or focuses. Each part binds its own with `:ref="els.x"`;
 * an element leaving the DOM sets its ref back to empty.
 */
export function islandElements() {
  return {
    /** The morphing box (pill ↔ panel): hover, click-through and docking go by its rectangle. */
    shell: ref<HTMLElement>(),
    /** The expanded panel: its height sizes the shell. */
    panel: ref<HTMLElement>(),
    /** The pill's move handle (a native drag region — no DOM events over it). */
    pillHandle: ref<HTMLElement>(),
    /** The orb button. */
    orbEl: ref<HTMLElement>(),
    /** The pill's lines: their natural width sizes the pill. */
    plineEl: ref<HTMLElement>(),
    chipsEl: ref<HTMLElement>(),
    statsEl: ref<HTMLElement>(),
    /** The quick note's text. */
    noteArea: ref<HTMLTextAreaElement>(),
    /** The chat area's reply. */
    chatInput: ref<HTMLTextAreaElement>(),
    /** The timeline track and its lanes (pointer → time / lane). */
    track: ref<HTMLElement>(),
    rowMain: ref<HTMLElement>(),
    /** The cut row's line (the hotkey and "continue that topic" focus it). */
    labelInput: ref<InstanceType<typeof QuickField>>(),
  }
}

export type IslandElements = ReturnType<typeof islandElements>
