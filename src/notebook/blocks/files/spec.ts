import type { BlockSpec } from '../../domain/blockSpec'
import { fenceOfLang, fixedHeight } from '../detectors'

/** The name of a note's own set of test files: the note's name made safe for a folder ('Файлы' — none). */
export function fileSetName(notePath: string): string {
  return (notePath.split('/').pop() || 'Файлы').replace(/\.md$/i, '').replace(/[\\/:*?"<>|]/g, '_') || 'Файлы'
}

/** A set of test files for scenarios with uploads (```files, JSON: the set's name). */
export const filesSpec: BlockSpec<'files'> = {
  kind: 'files',
  title: 'Тестовые файлы',
  detect: fenceOfLang('files'),
  estimateHeight: fixedHeight(220),
  rawEditable: true,
  commands: [
    {
      id: 'files',
      title: 'Тестовые файлы',
      hint: 'Набор файлов для сценариев с загрузкой: свои, записанные, сгенерированные; у каждого — принять / отклонить. Сценарий прогоняется по всему набору',
      icon: 'folder',
      keys: ['файлы', 'файл', 'загрузка', 'импорт', 'excel', 'xlsx', 'csv', 'upload', 'files', 'тестовые'],
      // a set of the note's own (by its name) — not the notebook's shared «Записанные» with whatever is in it already
      run: (c) => ({ kind: 'insertBlock', markdown: `\`\`\`files\n${JSON.stringify({ set: fileSetName(c.notePath) }, null, 2)}\n\`\`\`` }),
    },
  ],
}
