import type { Component } from 'vue'

/**
 * How a block kind is drawn (blocks/<kind>/view.ts): its component and which of the host's props it takes. The host
 * passes only those — a prop a component does not declare would fall through onto its root element (an `onChange`
 * there would catch the DOM's change events). One contract for every kind: the host's callbacks are props
 * (`onChange`, `onExit`, `onGo`…), declared by the component.
 */

/** Everything the block host can give a component. */
export interface HostProps {
  src: string
  path: string
  line: number
  autofocus?: boolean
  /** The note's headings (the table of contents). */
  headings: Array<{ level: number; text: string; pos: number }>
  /** It is inside a loop (a template is filled per pass, not here). */
  inLoop: boolean
  onChange: (src: string) => void
  onExit: (dir: 1 | -1) => void
  onGo: (pos: number) => void
  onTranscribe?: (rel: string) => void
  onDropAudio?: (rel: string) => void
}
export type HostProp = keyof HostProps

/** How one pass's result of a runnable block is shown: a text, rows, an HTTP answer, a value. */
export const PASS_RESULT_SHAPES = ['markdown', 'rows', 'answer', 'value'] as const
export type PassResultShape = (typeof PASS_RESULT_SHAPES)[number]

export interface BlockView {
  component: Component
  /** The host's props the component takes. */
  props: readonly HostProp[]
}
export interface RunnableBlockView extends BlockView {
  passResult: PassResultShape
}

/** A component's props as the compiler knows them. */
type PropsOf<C> = C extends abstract new (...args: never[]) => { $props: infer P } ? P : never
/** The host's props a component declares, each taking what the host gives under that name. */
type TakenBy<C> = { [K in HostProp & keyof PropsOf<C>]-?: HostProps[K] extends PropsOf<C>[K] ? K : never }[HostProp & keyof PropsOf<C>]
/** The component's props the host must give (required ones): each must be listed. */
type NeededBy<C> = { [K in keyof PropsOf<C>]-?: undefined extends PropsOf<C>[K] ? never : K }[keyof PropsOf<C>]

/**
 * A kind's view: its component and the host's props it takes — the compiler checks each is a prop the component
 * declares (of the host's type) and that every prop it requires is listed.
 */
export function blockView<C extends Component, const P extends readonly TakenBy<C>[]>(component: C, props: P & (NeededBy<C> extends P[number] ? unknown : { missing: Exclude<NeededBy<C>, P[number]> })): BlockView {
  return { component, props }
}
/** A runnable kind's view: also how its pass's result is shown. */
export function runnableView<C extends Component, const P extends readonly TakenBy<C>[]>(
  component: C,
  props: P & (NeededBy<C> extends P[number] ? unknown : { missing: Exclude<NeededBy<C>, P[number]> }),
  passResult: PassResultShape,
): RunnableBlockView {
  return { component, props, passResult }
}

/** The host's props a view takes, picked from all of them. */
export function pickHostProps(view: BlockView, all: HostProps): Record<string, unknown> {
  return Object.fromEntries(view.props.map((k) => [k, all[k]]))
}
