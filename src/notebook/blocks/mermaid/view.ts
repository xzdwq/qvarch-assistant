import { blockView } from '../../ui/blockView'
import BlockMermaid from './BlockMermaid.vue'

/** A Mermaid diagram and its source. */
export const mermaidView = blockView(BlockMermaid, ['src', 'autofocus', 'onChange'])
