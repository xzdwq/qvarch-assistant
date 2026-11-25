/**
 * Why a page's process ended, told on its place: Chromium's reason (Electron's `render-process-gone`) and the exit
 * code — read as Windows reports it (an NTSTATUS), so a crash can be told from a lack of memory or a process stopped
 * from outside.
 */

/** Chromium's reasons a page's process ended (Electron's `RenderProcessGoneDetails.reason`), as told to the person. */
export const GONE_REASON_TEXT: Record<string, string> = {
  crashed: 'Процесс страницы упал — сбой в движке браузера или в коде страницы.',
  oom: 'Странице не хватило памяти.',
  killed: 'Процесс страницы остановлен извне — системой, антивирусом или диспетчером задач.',
  'abnormal-exit': 'Процесс страницы завершился с ошибкой.',
  'launch-failed': 'Процесс страницы не смог запуститься.',
  'integrity-failure': 'Windows не дала запустить процесс страницы (проверка целостности кода — часто её останавливает антивирус).',
  'memory-eviction': 'Система выгрузила страницу, освобождая память.',
}
/** A reason not known (a newer Chromium's): said in general. */
const GONE_REASON_OTHER = 'Процесс страницы завершился.'

/** The exit codes worth naming (Windows' NTSTATUS, as an unsigned number). */
const EXIT_CODE_NAMES: Record<number, string> = {
  0xc0000005: 'нарушение доступа к памяти',
  0xc0000409: 'аварийная остановка (проверка внутри движка)',
  0x80000003: 'аварийная остановка (проверка внутри движка)',
  0xe0000008: 'не хватило памяти',
  0xc000001d: 'недопустимая инструкция процессора',
  0xc00000fd: 'переполнение стека',
  0xc0000135: 'не найдена нужная библиотека',
  0xc0000142: 'процесс не смог запуститься',
  0xc0000022: 'доступ запрещён',
}

/** The text for a page's process gone: its reason. */
export function goneReasonText(reason: string): string {
  return Object.hasOwn(GONE_REASON_TEXT, reason) ? GONE_REASON_TEXT[reason] : GONE_REASON_OTHER
}

/**
 * An exit code as read: a large one (Windows' NTSTATUS, signed or not) — hex with its name when known; a small one —
 * as is; none (0) — ''.
 */
export function exitCodeText(code: number): string {
  if (!code || !Number.isFinite(code)) return ''
  const u = code >>> 0
  if (u <= 0xffff) return String(code)
  const hex = `0x${u.toString(16).toUpperCase().padStart(8, '0')}`
  const name = EXIT_CODE_NAMES[u]
  return name ? `${hex} — ${name}` : hex
}

/** The site whose caches are cleared when its page is started again (http/https only — others have none). */
export function restartOrigin(url: string): string | undefined {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : undefined
  } catch {
    return undefined
  }
}
