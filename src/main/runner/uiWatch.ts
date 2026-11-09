import type { Page } from 'playwright-core'
import { emptyUiSamples, type UiEvent, type UiFrame, type UiSamples } from '../../shared/uiMetrics'

/** The binding the page sends its batches by (a name no site has). */
const BINDING = '__qaUiReport'
/** At most this many measured events / long frames kept from a run (a long one — its first). */
const KEEP = 3000

/**
 * The page's observers (sent into it as they are — nothing from outside): every event of 16 ms and longer the browser
 * measured, every long frame (over 50 ms) with its scripts, every input / key / click counted; sent in batches (twice
 * a second, and when the page goes). Once per document.
 */
function uiObservers(): void {
  const w = window as unknown as { __qaUi?: boolean; __qaUiReport?: (b: unknown) => void; __qaUiFlush?: () => void }
  if (w.__qaUi) return
  w.__qaUi = true
  const events: unknown[] = []
  const frames: unknown[] = []
  const counts = { keys: 0, inputs: 0, clicks: 0 }
  const at = (t: number) => Math.round(performance.timeOrigin + t)
  /** What the event was on, as a person reads it: its label / placeholder / name / text, else its tag. */
  const label = (t: EventTarget | null): string => {
    const el = t instanceof Element ? t : null
    if (!el) return ''
    const i = el as HTMLInputElement
    const named = el.getAttribute('aria-label') || i.labels?.[0]?.textContent?.trim() || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || (el.textContent ?? '').trim().slice(0, 40)
    return `${el.tagName.toLowerCase()}${named ? ` «${named.replace(/\s+/g, ' ').slice(0, 40)}»` : ''}`
  }
  const flush = () => {
    if (!events.length && !frames.length && !counts.keys && !counts.inputs && !counts.clicks) return
    const batch = { events: events.splice(0), frames: frames.splice(0), counts: { ...counts } }
    counts.keys = counts.inputs = counts.clicks = 0
    w.__qaUiReport?.(batch)
  }
  w.__qaUiFlush = flush
  addEventListener('keydown', () => counts.keys++, true)
  addEventListener('input', () => counts.inputs++, true)
  addEventListener('click', () => counts.clicks++, true)
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceEventTiming[])
        events.push({ name: e.name, d: Math.round(e.duration), delay: Math.round(e.processingStart - e.startTime), proc: Math.round(e.processingEnd - e.processingStart), at: at(e.startTime), id: (e as { interactionId?: number }).interactionId ?? 0, target: label(e.target) })
    }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit)
  } catch {
    // no Event Timing here
  }
  try {
    new PerformanceObserver((list) => {
      for (const f of list.getEntries() as Array<PerformanceEntry & { blockingDuration: number; scripts: Array<{ sourceURL: string; sourceCharPosition: number; sourceFunctionName: string; invoker: string; duration: number }> }>)
        frames.push({
          d: Math.round(f.duration),
          block: Math.round(f.blockingDuration),
          at: at(f.startTime),
          scripts: (f.scripts ?? [])
            .slice(0, 4)
            .map((s) => ({ src: `${s.sourceURL}${s.sourceCharPosition >= 0 ? `:${s.sourceCharPosition}` : ''}`, fn: s.sourceFunctionName, inv: s.invoker, d: Math.round(s.duration) })),
        })
    }).observe({ type: 'long-animation-frame', buffered: true })
  } catch {
    // no Long Animation Frames here
  }
  setInterval(flush, 500)
  addEventListener('pagehide', flush)
}

/**
 * How the run's page answers the person, watched from now on: this document and every next one of the page (the
 * observers put in each); the batches gathered here. `drain` — the last one taken (the run's end).
 */
export async function watchUi(page: Page): Promise<{ samples: UiSamples; drain(): Promise<void> }> {
  const samples = emptyUiSamples()
  const take = (b: { events?: UiEvent[]; frames?: UiFrame[]; counts?: Partial<UiSamples['counts']> }) => {
    for (const e of b.events ?? []) if (samples.events.length < KEEP) samples.events.push(e)
    for (const f of b.frames ?? []) if (samples.frames.length < KEEP) samples.frames.push(f)
    samples.counts.keys += Number(b.counts?.keys) || 0
    samples.counts.inputs += Number(b.counts?.inputs) || 0
    samples.counts.clicks += Number(b.counts?.clicks) || 0
  }
  await page.exposeBinding(BINDING, (_src, b) => take(b as Parameters<typeof take>[0]))
  await page.addInitScript(uiObservers)
  await page.evaluate(uiObservers).catch(() => undefined)
  return {
    samples,
    drain: async () => {
      if (page.isClosed()) return
      await page.evaluate(() => (window as unknown as { __qaUiFlush?: () => void }).__qaUiFlush?.()).catch(() => undefined)
      // (the binding's call reaches here a moment later)
      await page.waitForTimeout(150).catch(() => undefined)
    },
  }
}
