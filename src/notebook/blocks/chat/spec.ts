import type { BlockSpec } from '../../domain/blockSpec'
import { fenceOfLang, fixedHeight } from '../detectors'

/** A chat of the transport server right in the note (```chat); «@чат» offers the rooms of this device. */
export const chatSpec: BlockSpec<'chat'> = {
  kind: 'chat',
  title: 'Чат',
  detect: fenceOfLang('chat'),
  estimateHeight: fixedHeight(460),
  rawEditable: true,
  commands: [
    {
      id: 'chat',
      title: 'Чат',
      hint: 'Переписка через сервер прямо в заметке (Настройки → Сервер и чат)',
      icon: 'chat',
      keys: ['чат', 'chat', 'переписка', 'сообщения', 'messages', 'обсуждение'],
      run: (c) => ({ kind: 'insertText', text: c.latin ? '@chat ' : '@чат ', keepMenu: true }),
    },
  ],
}
