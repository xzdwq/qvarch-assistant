import { itemLabel, runItemNamed, whenRunWaits, type RunWait } from '@nb/engine'

/**
 * A run asked for by the AI that ends — or stops to wait for a person (a terminal asks for a password): whichever comes
 * first. The run is not stopped by it: the person answers in the block and it goes on.
 */
export async function doneOrWaiting<T>(notePath: string, run: Promise<T>, keys?: ReadonlySet<string>): Promise<{ done: T } | { wait: RunWait }> {
  const w = whenRunWaits(notePath, keys)
  try {
    return await Promise.race([run.then((done) => ({ done })), w.wait.then((wait) => ({ wait }))])
  } finally {
    w.cancel()
  }
}

/** What the AI is told of a run waiting for a person: which block, what it asked, what to do (and what not to). */
export function waitWords(noteText: string, w: RunWait): string {
  const item = runItemNamed(noteText, w.key)
  const block = item ? itemLabel(item) : `блок «${w.key}»`
  return [
    `⏸ ${block} ждёт ввода человека: «${w.prompt}».`,
    'Блок продолжает выполняться: ответ (например, пароль sudo) человек вводит в поле под выводом блока. Ты его не вводишь, не подбираешь и не просишь прислать в чат.',
    `Работаешь по плану harness — закончи ход: harness_report state=help, question: «${block} ждёт ввода (${w.prompt}) — введите ответ в поле под выводом блока и нажмите «Продолжить»». Без harness — скажи человеку то же в ответе.`,
    'Результат блока после ввода — note_results.',
  ].join('\n')
}
