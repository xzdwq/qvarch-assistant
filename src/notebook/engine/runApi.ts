import type { QaApi } from '../../shared/api'

/**
 * The calls the run engine makes to the main process (the preload bridge `window.qa`): the runs file, requests,
 * queries, code / Playwright / loop processes. Tests put a stand-in with setRunApi.
 */
export type RunApi = Pick<QaApi, 'runLoad' | 'runSave' | 'httpLoad' | 'httpRun' | 'httpAbort' | 'sql' | 'runCode' | 'runCodeStop' | 'runPw' | 'runPwStop' | 'onPwProgress' | 'runLoop' | 'runLoopPass' | 'runLoopStop' | 'onLoopPass' | 'onRunEmit' | 'valueFile'>

let override: RunApi | undefined

/** The main-process calls (the stand-in when a test set one). */
export function runApi(): RunApi {
  return override ?? (globalThis as unknown as { window: { qa: RunApi } }).window.qa
}
/** A stand-in for the main-process calls (tests); undefined — the real bridge again. */
export function setRunApi(api: RunApi | undefined): void {
  override = api
}

/** An error's text as the person sees it (the IPC wrapper's prefix cut away). */
export { remoteError as errorText } from '../../shared/remoteError'
