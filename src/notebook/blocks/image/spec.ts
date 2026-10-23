import { IMAGE_EMBED } from '../../../shared/vault'
import type { BlockSpec } from '../../domain/blockSpec'
import { fixedHeight, singleLine } from '../detectors'

/** A picture embedded on a line of its own (![[.images/….png]]); «@изображение» picks a file. */
export const imageSpec: BlockSpec<'image'> = {
  kind: 'image',
  title: 'Изображение',
  detect: singleLine(41, IMAGE_EMBED),
  estimateHeight: fixedHeight(320),
  rawEditable: false,
  commands: [
    {
      id: 'image',
      title: 'Изображение',
      hint: 'Вставить картинку из файла',
      icon: 'image',
      keys: ['изображение', 'картинка', 'фото', 'image', 'picture', 'img', 'photo'],
      run: () => ({ kind: 'request', action: 'pickImage' }),
    },
  ],
}
