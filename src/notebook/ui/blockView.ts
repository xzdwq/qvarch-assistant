import type { Component } from 'vue'

/**
 * How a block kind is drawn (blocks/<kind>/view.ts): its component and which of the host's props it takes. The host
 * passes only those — a prop a component does not declare would fall through onto its root element (an `onChange`
 * there would catch the DOM's change events).
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
export type PassResultShape = 'markdown' | 'rows' | 'answer' | 'value'

export interface BlockView {
  component: Component
  /** The host's props the component takes. */
  props: readonly HostProp[]
}
export interface RunnableBlockView extends BlockView {
  passResult: PassResultShape
}

/** The host's props a view takes, picked from all of them. */
export function pickHostProps(view: BlockView, all: HostProps): Record<string, unknown> {
  return Object.fromEntries(view.props.map((k) => [k, all[k]]))
}
