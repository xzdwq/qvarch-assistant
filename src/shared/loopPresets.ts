/**
 * The kinds of a loop's head, to start from: each fills the head with its code, over the note's own values (the last
 * list, the last object — or a name to change). The loop's blocks get the names given to `body({ … })`.
 */
export interface LoopPreset {
  id: string
  title: string
  hint: string
  code: (list: string, obj: string) => string
  /** Passes at once it wants (Promise.all). */
  parallel?: number
}
export const LOOP_PRESETS: LoopPreset[] = [
  { id: 'entries', title: 'По массиву, с номером', hint: 'for…of + entries(): i — номер с 0, item — элемент', code: (l) => `for (const [i, item] of ${l}.entries()) await body({ i, item })` },
  { id: 'of', title: 'По массиву', hint: 'for…of: элемент за элементом', code: (l) => `for (const item of ${l}) await body({ item })` },
  { id: 'index', title: 'Счётчик i++', hint: 'for (let i = 0; i < length; i++)', code: (l) => `for (let i = 0; i < ${l}.length; i++) await body({ i, item: ${l}[i] })` },
  { id: 'times', title: 'Повторить N раз', hint: 'n = 1…5', code: () => `for (let n = 1; n <= 5; n++) await body({ n })` },
  { id: 'filter', title: 'По массиву с условием', hint: 'пропустить ненужные: continue', code: (l) => `for (const item of ${l}) {\n  if (!item) continue // условие: какие пропустить\n  await body({ item })\n}` },
  { id: 'all', title: 'Параллельно', hint: 'Promise.all: несколько проходов сразу (сколько — «параллельно»)', code: (l) => `await Promise.all(${l}.map((item, i) => body({ i, item })))`, parallel: 4 },
  { id: 'forEach', title: 'forEach', hint: 'не ждёт проходов — как в JS: все сразу (до «параллельно»)', code: (l) => `${l}.forEach((item, i) => body({ i, item }))` },
  { id: 'in', title: 'По ключам объекта', hint: 'for…in: key — ключ, value — значение', code: (_l, o) => `for (const key in ${o}) await body({ key, value: ${o}[key] })` },
  { id: 'objEntries', title: 'Object.entries', hint: 'пары [ключ, значение] объекта', code: (_l, o) => `for (const [key, value] of Object.entries(${o})) await body({ key, value })` },
  { id: 'pages', title: 'Постранично (while)', hint: 'запрос страницы за страницей, пока ответ не пуст: body() возвращает то, что дали блоки прохода', code: () => `let page = 1\nwhile (true) {\n  const r = await body({ page })\n  // выход: по ответу блока цикла (его имя — r.<имя>)\n  if (!r.resp?.body?.length) break\n  page++\n}` },
  { id: 'while', title: 'Пока условие (while)', hint: 'while с выходом по условию; «макс.» — защита от бесконечного', code: () => `let n = 0\nwhile (n < 10) {\n  await body({ n })\n  n++\n}` },
]
