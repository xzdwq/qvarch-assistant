import type { Page } from 'playwright-core'
import { PageScreen } from './pageScreen'
import type { QaCheck } from '../../shared/qaChecks'
import { fieldMatrixCheck, type MatrixOpts } from './qa/fieldMatrixCheck'
import { fileChecks } from './qa/fileChecks'
import { formChecks } from './qa/formChecks'
import { fuzzCheck } from './qa/fuzzCheck'
import { layoutChecks } from './qa/layoutChecks'
import { loadCheck } from './qa/loadCheck'
import { QaContext, type Step } from './qa/qaContext'

/**
 * `qa` of a Playwright block: ready checks around recorded actions. It watches the page's requests (what is on
 * the way, what answered what), waits for the page to settle after an action, and judges: an «unsaved changes»
 * dialog after a good save, a page not the same after a reload, a save sent twice, what a repeat changes.
 * Each check goes to `checks` (shown in the block); a failed one fails the run. The checks live in ./qa/.
 */
export function makeQa(page: Page, step: Step, checks: QaCheck[], dir: string, filesRoot = '', gathered: (v: unknown) => void = () => undefined, matrixRun: MatrixOpts = {}, screen = new PageScreen(page)) {
  const ctx = new QaContext(page, step, checks, dir, filesRoot, screen)
  const matrix = fieldMatrixCheck(ctx)
  const files = fileChecks(ctx)
  const form = formChecks(ctx)
  const layout = layoutChecks(ctx)
  return {
    /**
     * The window as it was when recorded: its size in CSS px and its pixel density (the browser's zoom changes
     * both — a page lays itself out by them).
     */
    window: (o: { width: number; height: number; dpr?: number }) => screen.set(o),
    file: files.file,
    files: files.files,
    dropFiles: files.dropFiles,
    eachFile: files.eachFile,
    saveAndLeave: form.saveAndLeave,
    sameAfterReload: form.sameAfterReload,
    doubleSubmit: form.doubleSubmit,
    repeat: form.repeat,
    fuzz: fuzzCheck(ctx),
    // (each value's outcome — the block's value when the scenario returns none of its own)
    // (the run's own: what the run before found — kept while its inputs are the same; what to run anew)
    fieldMatrix: async (fields: Parameters<typeof matrix>[0], run: Parameters<typeof matrix>[1], opts: MatrixOpts = {}) => {
      return matrix(fields, run, { ...matrixRun, ...opts, gathered })
    },
    layout: layout.layout,
    layoutEach: layout.layoutEach,
    manyRows: loadCheck(ctx),
    snapshot: form.snapshot,
    compareWith: form.compareWith,
  }
}
