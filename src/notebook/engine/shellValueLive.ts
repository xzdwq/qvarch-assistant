import { OutputCollector, type ShellValue } from '../../shared/shell/output'
import { publishGathered } from './runStore'

/** A growing value is published at most this often (ms): a log stream does not redraw the note on every line. */
const LIVE_VALUE_MS = 300

/** A shell run's value as its output comes: fed by its live chunks, ended with the run. */
export interface LiveValue {
  feed(stream: 'out' | 'err', chunk: string): void
  /** The run is over: its final value replaces the growing one; none (it never ended well) — what came, as partial. */
  end(final: ShellValue | undefined): void
}

/**
 * A shell run's value published while it runs (`running`, exitCode -1): whatever reads it — a «Значение» block
 * watching, a template — sees the output grow without waiting for the run's end (a `docker logs -f` never ends).
 */
export function liveValue(notePath: string, name: string, block: string, match?: { source: string; flags: string }): LiveValue {
  const out = new OutputCollector(match)
  const t0 = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let shown = false
  let over = false
  const show = () => {
    timer = undefined
    if (over) return
    shown = true
    publishGathered(notePath, name, out.snapshot(Date.now() - t0), 'shell', block, { running: true })
  }
  return {
    feed(stream, chunk) {
      out.feed(stream, chunk)
      timer ??= setTimeout(show, LIVE_VALUE_MS)
    },
    end(final) {
      over = true
      clearTimeout(timer)
      if (!shown || final) return
      const { running: _, ...rest } = out.snapshot(Date.now() - t0)
      publishGathered(notePath, name, rest, 'shell', block, { partial: true })
    },
  }
}
