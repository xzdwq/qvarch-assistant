/** The arrow keys (by `KeyboardEvent.key`) and the unit shift each one means: x, y (y down). */
export const ARROW_SHIFTS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const satisfies Record<string, readonly [number, number]>
export type ArrowKey = keyof typeof ARROW_SHIFTS
export const isArrowKey = (key: string): key is ArrowKey => Object.hasOwn(ARROW_SHIFTS, key)
