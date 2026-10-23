import { AUDIO_EMBED } from '../../../shared/vault'
import type { BlockSpec } from '../../domain/blockSpec'
import { fixedHeight, singleLine } from '../detectors'

/** A voice recording embedded on a line of its own (![[.audio/….webm]]); «@аудио» starts recording at once. */
export const audioSpec: BlockSpec<'audio'> = {
  kind: 'audio',
  title: 'Аудио',
  detect: singleLine(40, AUDIO_EMBED),
  estimateHeight: fixedHeight(48),
  rawEditable: false,
  commands: [
    {
      id: 'audio',
      title: 'Аудио',
      hint: 'Записать голос в заметку — запись начнётся сразу',
      icon: 'mic',
      keys: ['аудио', 'audio', 'голос', 'voice', 'запись', 'record', 'диктовка'],
      run: () => ({ kind: 'request', action: 'record' }),
    },
  ],
}
