/** The known network failures (Chromium's net::ERR_… or Node's cause code) and their words. */
const KNOWN_FAILURES: Array<[RegExp, string]> = [
  [/INTERNET_DISCONNECTED|NETWORK_CHANGED|ENETUNREACH/, 'нет сети'],
  [/NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/, 'адрес не найден (DNS, VPN?)'],
  [/TIMED_OUT|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/, 'сервер не ответил вовремя'],
  [/CONNECTION_REFUSED|ECONNREFUSED/, 'соединение отклонено'],
  [/CONNECTION_RESET|CONNECTION_CLOSED|ECONNRESET|UND_ERR_SOCKET/, 'соединение оборвалось'],
  [/PROXY|TUNNEL/, 'ошибка прокси'],
  [/CERT|SSL|UNABLE_TO_VERIFY|SELF_SIGNED/, 'сертификат не принят'],
]

/** A network failure in words (Chromium's net::ERR_… or Node's cause code). */
export function netReason(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } }
  const raw = `${err?.cause?.code ?? ''} ${err?.message ?? ''} ${err?.cause?.message ?? ''}`
  for (const [re, text] of KNOWN_FAILURES) if (re.test(raw)) return text
  return (err?.cause?.message ?? err?.message ?? String(e)).trim() || 'неизвестная ошибка сети'
}
