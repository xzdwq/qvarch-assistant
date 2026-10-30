import { app as electronApp } from 'electron'
import { contentsOf, type AppContext } from '../app/appContext'
import { CronSchedule } from '../cron/cronSchedule'
import type { McpHost } from './mcpIpc'
import { emit, handle } from './router'

/** The schedule made (before the AI's tools — they work with it). */
export const makeCronSchedule = (app: AppContext): CronSchedule => new CronSchedule(app.store.root)

/**
 * Notes run on a schedule: the window's calls (the jobs, made, changed, deleted, run now) and their news; the
 * schedule started — each job run by the window (in the background), its notes followed through renames.
 */
export function registerCronIpc(app: AppContext, crons: CronSchedule, host: McpHost): void {
  handle('cronList', () => crons.list())
  handle('cronSave', (_e, patch) => crons.save(patch ?? {}))
  handle('cronRemove', (_e, id) => crons.remove(String(id)))
  handle('cronRunNow', (_e, id) => crons.runNow(String(id)))
  crons.onChange((jobs) => {
    const w = contentsOf(app.windows.main)
    if (w) emit(w, 'onCrons', jobs)
  })
  app.vault.onRemap((from, to) => crons.remap(from, to))
  crons.start((note, trigger) => host.toolCtx.ui<{ error?: string }>('cron', { path: note, trigger }))
  electronApp.on('will-quit', () => crons.stop())
}
