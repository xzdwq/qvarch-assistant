/**
 * What an answer's status says about the way the request went (not about the thing tested) — told with a request's
 * report, so the next try takes another way instead of the same one again.
 */
const STATUS_HINTS: Readonly<Record<number, string>> = {
  401: 'нет входа: передай вход (флаг session у блока — cookies встроенного браузера) или токен',
  403: 'нет прав или вход не передан (session / токен); если в браузере страница открывается, а запрос — нет, сайт может отказывать автоматическим запросам — тогда сценарий в браузере приложения (browser=qvarch in=<браузер заметки>)',
  429: 'слишком часто: подожди и сделай реже (пауза между запросами, меньше параллельных) — не повторяй сразу',
  451: 'сайт отказывает автоматическим запросам: не подбирай заголовки и задержки — сценарий в браузере приложения (browser=qvarch in=<браузер заметки>: настоящий профиль, вход и окно); не откроется и там — нужен официальный API, выгрузка или человек',
}

/** The hint an answer's status gives (none — nothing to say beyond the status). */
export const statusHint = (status: number): string | undefined => STATUS_HINTS[status]
