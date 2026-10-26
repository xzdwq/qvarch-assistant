import { sweepTestDirs } from './testTemp'

/** Left by earlier runs and long free (not another run's going on now). */
const STALE_MS = 30 * 60_000

/** Before the run: the folders earlier runs could not take away; after it: the ones it made. */
export default function setup(): () => void {
  const start = Date.now()
  sweepTestDirs({ before: start - STALE_MS })
  return () => sweepTestDirs({ since: start })
}
