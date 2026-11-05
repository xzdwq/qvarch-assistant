import { blockView } from '../../ui/blockView'
import BlockAudio from './BlockAudio.vue'

/** A recording: its player, transcription, deletion. */
export const audioView = blockView(BlockAudio, ['src', 'onTranscribe', 'onDropAudio'])
