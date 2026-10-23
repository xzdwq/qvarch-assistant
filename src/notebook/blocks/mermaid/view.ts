import type { BlockView } from '../../ui/blockView'
import BlockMermaid from './BlockMermaid.vue'

/** A Mermaid diagram and its source. */
export const mermaidView: BlockView = { component: BlockMermaid, props: ['src', 'autofocus', 'onChange'] }
