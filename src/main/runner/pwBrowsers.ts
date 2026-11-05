import type { PwBrowser } from '../../notebook/domain/blockInfo'

/**
 * A Playwright run's browser and how its failures read: one registry entry per browser a block names (its name in a
 * step, Playwright's channel, what to say when it is not on this computer), the failures sorted by what they are.
 */
export interface PwLaunch {
  /** Its name in the «Запуск …» step. */
  label: string
  /** Playwright's channel (none — the downloaded Chromium). */
  channel?: string
  /** It is not installed: what to do instead. */
  missing: string
}
export const PW_LAUNCH: Record<PwBrowser, PwLaunch> = {
  msedge: { label: 'Edge', channel: 'msedge', missing: 'Не найден Microsoft Edge — укажите browser=chrome в строке блока' },
  chrome: { label: 'Chrome', channel: 'chrome', missing: 'Не найден Google Chrome — уберите browser=chrome (будет Edge)' },
  chromium: { label: 'Chromium', missing: 'Chromium не скачан — используйте Edge или Chrome' },
  // (the app's own browser is lent to the run — launched only if no page was lent: then as the downloaded Chromium)
  qvarch: { label: 'Chromium', missing: 'Chromium не скачан — используйте Edge или Chrome' },
}

/** What a thrown value says about itself: its class's name, a matcher's result (Playwright's expect). */
const errorName = (err: unknown) => (err instanceof Error ? err.name : '')
const hasMatcherResult = (err: unknown) => typeof err === 'object' && err !== null && 'matcherResult' in err

/**
 * The page the run drove was closed under it: Playwright's TargetClosedError; else (an older Playwright, a bridge's
 * own words) by its message.
 */
export function pageClosed(err: unknown, message: string): boolean {
  return errorName(err) === 'TargetClosedError' || /has been closed|Target closed|Вкладка закрыта/i.test(message)
}

/**
 * A check failed (the test failed — not broke): an expect's error carries its matcher's result; a ready check of
 * qa.… says «Проверка «…» не прошла»; an error of neither kind — read by its message as before (an expect wrapped by
 * the scenario's own code).
 */
export function checkFailed(err: unknown, message: string): boolean {
  return hasMatcherResult(err) || /^Проверка «/.test(message) || /expect\(|toHave|toBe|toEqual|toContain|toMatch/.test(message)
}
