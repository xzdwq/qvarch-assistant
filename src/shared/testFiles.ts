/**
 * Test files kept with the notebook (vault/.files/<набор>/<файл>): the files a scenario uploads — recorded ones (a file
 * picked while recording is copied into «Записанные»), one's own, generated — each with what it should lead to (taken
 * / refused) and a note. A scenario names one as qa.file('Набор/файл.xlsx'); «Прогнать с разными файлами» runs it once
 * per file of a set.
 */
export interface TestFile {
  name: string
  size: number
  mtime: number
  /** What the page should do with it: take it, or refuse it (an error said). */
  expect?: 'ok' | 'bad'
  note?: string
}
export interface TestFileSet {
  name: string
  count: number
}
/** The set a recording puts the files picked into. */
export const RECORDED_SET = 'Записанные'

export interface TestFilesApi {
  sets(): TestFileSet[]
  list(set: string): TestFile[]
  /** Files from the disk copied in (a name taken — «имя (2).xlsx»); returns their names in the set. */
  add(set: string, paths: string[]): string[]
  /** A file of bytes (made here: generated, dropped). */
  write(set: string, name: string, bytes: Uint8Array): string
  remove(set: string, name: string): void
  rename(set: string, name: string, to: string): string
  meta(set: string, name: string, patch: { expect?: 'ok' | 'bad' | null; note?: string }): void
  createSet(name: string): string
  removeSet(name: string): void
  /** The system's window to pick files into a set; the names added. */
  pick(set: string): Promise<string[]>
  open(set: string, name: string): Promise<void>
  reveal(set: string, name: string): void
  /** Excel / CSV made by a spec (the right file and one per fault); their names. */
  generate(set: string, spec: import('./excelGen').XSpec, defects: string[]): Promise<string[]>
  /** A template picked (its header and first rows), none — cancelled. */
  template(): Promise<{ name: string; sheet: string; headers: string[]; samples: string[][] } | undefined>
}
export const TEST_FILES_METHODS: Array<keyof TestFilesApi> = ['sets', 'list', 'add', 'write', 'remove', 'rename', 'meta', 'createSet', 'removeSet', 'pick', 'open', 'reveal', 'generate', 'template']

// ---------- a scenario run with a file: what came of it ----------
export interface FileObs {
  error?: string
  /** The changes sent (an upload, an import) and their answers. */
  muts: Array<{ status?: number; res?: string; line: string }>
  /** What the page said (notifications, alerts, field errors). */
  hints: string[]
  /** The page's own JS errors during the run (it fell over the file). */
  pageErrors?: string[]
  /** No request of the upload found: the changing requests the run made (one of them may be pinned as the upload). */
  others?: string[]
}
/** Words of an error (a notification may also say «Загружено 10 строк» — that is no refusal). */
export const ERROR_WORDS = /ошиб|не удалось|неверн|некоррект|недопуст|обязател|превыш|не найден|отклон|запрещ|error|fail|invalid|denied|not allowed|too large|required/i
const cut = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s)
/** The server's words in an answer (message / error / errors[]), else its text, short. */
export function answerText(res?: string): string {
  if (!res) return ''
  try {
    const j = JSON.parse(res) as Record<string, unknown>
    const m = j.message ?? j.error ?? j.detail ?? j.title ?? (Array.isArray(j.errors) ? (j.errors as Array<Record<string, unknown> | string>).map((e) => (typeof e === 'string' ? e : (e.message ?? JSON.stringify(e)))).join('; ') : undefined)
    if (m !== undefined) return cut(Array.isArray(m) ? m.join('; ') : typeof m === 'string' ? m : JSON.stringify(m))
  } catch {
    // not JSON
  }
  return cut(res.replace(/\s+/g, ' ').trim())
}
export function judgeFile(expect: TestFile['expect'], o: FileObs): { state: 'ok' | 'warn' | 'fail'; result: string; detail: string } {
  const bad5 = o.muts.find((m) => (m.status ?? 0) >= 500)
  if (bad5) return { state: 'fail', result: `Ошибка сервера ${bad5.status}`, detail: answerText(bad5.res) || bad5.line }
  const errs = o.hints.filter((h) => ERROR_WORDS.test(h))
  const bad4 = o.muts.find((m) => (m.status ?? 0) >= 400)
  const good = o.muts.some((m) => (m.status ?? 0) >= 200 && (m.status ?? 0) < 300)
  const said = errs.join(' · ') || (bad4 ? answerText(bad4.res) : '')
  const refused = !!bad4 || errs.length > 0
  const js = o.pageErrors?.length ? `ошибка на странице: ${cut(o.pageErrors[0])}` : ''
  // the scenario stopped short, and no refusal explains it: the test did not do what it was written for — failed (a
  // refused file may well stop the steps after it — that is its refusal, said below)
  if (o.error && !refused) {
    const req = good ? `запрос ушёл (${o.muts.find((m) => (m.status ?? 0) < 300)?.line ?? '2xx'}), ` : 'запрос загрузки не ушёл, '
    return { state: 'fail', result: 'Сценарий не прошёл', detail: `${req}шаг не выполнился: ${cut(o.error.split('\n')[0])}${js ? `; ${js}` : ''}` }
  }
  if (!refused && good) {
    if (js) return { state: 'warn', result: 'Принят', detail: js }
    if (expect === 'bad') return { state: 'warn', result: 'Принят', detail: 'ожидалось, что файл отклонят' }
    return { state: 'ok', result: 'Принят', detail: o.hints.join(' · ') }
  }
  if (refused) {
    const result = bad4 ? `Отклонён (${bad4.status})` : 'Отклонён'
    if (expect === 'ok') return { state: 'warn', result, detail: `ожидалось принять; ${said || 'причина не сказана'}` }
    if (!errs.length) return { state: 'warn', result, detail: `страница ничего не сказала${said ? `; сервер: ${said}` : ''}` }
    return { state: 'ok', result, detail: said }
  }
  const seen = o.others?.length ? `; изменяющие запросы прогона: ${o.others.slice(0, 5).join(', ')}` : ''
  return { state: 'warn', result: 'Файл не отправлен', detail: `запрос с файлом не ушёл, страница ничего не сказала${js ? `; ${js}` : ''}${seen}` }
}

/** A set's / a file's name made safe (no folders, nothing hidden). */
export const safeName = (s: string) =>
  String(s)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120) || 'файл'
