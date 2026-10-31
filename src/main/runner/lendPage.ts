import type { WebContents } from 'electron'
import type { NoteRunFrame, PwTarget } from '../../shared/api'
import type { BridgeSource } from './cdpBridgeServer'
import type { Browser } from '../browser'
import type { Tab } from '../browser/tab'
import { openNotePage } from './notePage'

/**
 * A page of the app's own browser lent to a scenario's run (browser=qvarch): a tab of the Браузер section (the
 * block's own), or for a browser in the note (`in=…`) — a page of its own apart from the screen (notePage). A tab's
 * protocol is shared with the app's parts — the bridge undoes what the run set; here the page is kept from sleeping
 * and from being throttled meanwhile, and one run at a time goes in a page, never one being recorded in (the run's
 * clicks would be written down as the person's).
 */
export interface LentPage {
  source: BridgeSource
  /** Where it runs, for the run's first step. */
  label: string
  /** The page back: the protocol let go, its throttling as it was. */
  release(): void
}
/** The pages lent now (a tab — by its WebContents; a note's browser — by its note and name). */
const lent = new Set<string>()

/** A WebContents' protocol as the bridge needs it (`listen` — its messages, with the iframes' / workers' sessions). */
function sourceOf(wc: WebContents, listen: BridgeSource['onEvent']): BridgeSource {
  const dbg = wc.debugger
  return {
    send: (method, params, sessionId) => dbg.sendCommand(method, params, sessionId),
    target: async () => {
      const { targetInfo } = (await dbg.sendCommand('Target.getTargetInfo')) as { targetInfo: { targetId: string } }
      return { targetId: targetInfo.targetId, url: wc.getURL(), title: wc.getTitle(), product: `Chrome/${process.versions.chrome}`, userAgent: wc.getUserAgent() }
    },
    onEvent: listen,
    onGone: (fn) => {
      wc.once('destroyed', fn)
      return () => void wc.off('destroyed', fn)
    },
  }
}

/** A tab of the Браузер section: the protocol held as the run's, its messages from the tab's shared listener. */
function lendTab(browser: Browser, tab: Tab): Omit<LentPage, 'label'> {
  browser.cdp.use(tab, 'run')
  const wc = tab.view.webContents
  return {
    source: sourceOf(wc, (fn) => browser.cdp.listen('run', (t, m, p, s) => t === tab && fn(m, p, s), true)),
    release: () => {
      browser.cdp.drop(tab, 'run')
      // the device mode the tab is in told to the page again (the run's window size undone over it)
      browser.deviceAgain(tab)
    },
  }
}
/** A page of a note's browser, its own for the run (notePage): its protocol attached here, closed with the run. */
function lendOwnPage(page: { wc: WebContents; close(): void }): Omit<LentPage, 'label'> {
  const dbg = page.wc.debugger
  if (!dbg.isAttached()) dbg.attach('1.3')
  return {
    source: sourceOf(page.wc, (fn) => {
      const h = (_e: Electron.Event, method: string, params: Record<string, unknown>, sessionId: string) => fn(method, params, sessionId || undefined)
      dbg.on('message', h)
      return () => void dbg.off('message', h)
    }),
    release: () => page.close(),
  }
}

/** The page has loaded what it was asked for (a page still loading may have no frame to drive yet) — or 20 s passed. */
async function loaded(wc: WebContents): Promise<void> {
  if (!wc.isLoading() && wc.getURL()) return
  await new Promise<void>((ok) => {
    const done = () => {
      clearTimeout(timer)
      wc.off('did-stop-loading', done)
      ok()
    }
    const timer = setTimeout(done, 20_000)
    wc.on('did-stop-loading', done)
  })
}

/**
 * The page a run asks for — lent (or why not). `owner` — the block (its own tab in the Браузер), `url` — where the
 * scenario starts (a tab already there is taken).
 */
export async function lendPage(browser: Browser, sender: WebContents, target: PwTarget, owner: string, url: string | undefined, onFrame: (f: NoteRunFrame) => void): Promise<LentPage> {
  const picked = await pick(browser, sender, target, owner, url, onFrame)
  const wc = picked.wc
  if (lent.has(picked.key)) {
    picked.drop()
    throw new Error(target.kind === 'note' ? `В браузере «${target.name}» уже идёт сценарий — дождитесь его или остановите` : 'В этой вкладке уже идёт сценарий — дождитесь его или остановите')
  }
  if (browser.recordingIn(wc)) throw new Error('В этой вкладке идёт запись сценария — остановите её: клики теста записались бы как ваши')
  lent.add(picked.key)
  let p: Omit<LentPage, 'label'>
  try {
    await loaded(wc)
    if (wc.isDestroyed()) throw new Error('Вкладка закрыта')
    p = picked.lend()
  } catch (e) {
    lent.delete(picked.key)
    picked.drop()
    throw e
  }
  // a page not in front still draws (Playwright waits for its frames)
  wc.setBackgroundThrottling(false)
  return {
    ...p,
    label: picked.label,
    release: () => {
      lent.delete(picked.key)
      if (!wc.isDestroyed()) wc.setBackgroundThrottling(true)
      try {
        p.release()
      } catch {
        // (the page gone meanwhile: nothing to give back)
      }
    },
  }
}
/** The page picked: what tells it from the others (one run at a time in it), how it is lent, given up unlent. */
interface Picked {
  wc: WebContents
  key: string
  label: string
  lend: () => Omit<LentPage, 'label'>
  drop: () => void
}
async function pick(browser: Browser, sender: WebContents, target: PwTarget, owner: string, url: string | undefined, onFrame: (f: NoteRunFrame) => void): Promise<Picked> {
  switch (target.kind) {
    case 'section': {
      const tab = browser.runTab(owner, url)
      const wc = tab.view.webContents
      return { wc, key: `wc:${wc.id}`, label: 'Браузер Qvarch: вкладка раздела «Браузер»', lend: () => lendTab(browser, tab), drop: () => undefined }
    }
    case 'note': {
      const page = await openNotePage({ note: target.note, name: target.name, url: target.url, wc: target.wc, sender, onFrame })
      return { wc: page.wc, key: `note:${target.note}\n${target.name}`, label: `Браузер Qvarch: «${target.name}» в заметке (отдельная страница, экран не нужен)`, lend: () => lendOwnPage(page), drop: page.close }
    }
  }
}
