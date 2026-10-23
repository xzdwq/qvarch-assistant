/** `v-focus`: a field shown takes the focus with its text selected (a rename, a new name). */
export const vFocusSelect = { mounted: (el: HTMLInputElement) => (el.focus(), el.select()) }
