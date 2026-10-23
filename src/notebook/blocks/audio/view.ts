import type { BlockView } from '../../ui/blockView'
import BlockAudio from './BlockAudio.vue'

/** A recording: its player, transcription, deletion. */
export const audioView: BlockView = { component: BlockAudio, props: ['src', 'onTranscribe', 'onDropAudio'] }
