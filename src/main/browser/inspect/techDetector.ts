import { app } from 'electron'
import { join } from 'node:path'
import type { ProbePlan, TechSignals } from '../../../shared/browser/inspect/techEngine'
import type { TechHit } from '../../../shared/browser/inspect/types'
import { ProcessSupervisor } from '../../process/processSupervisor'

type Outcome = { ok: boolean; error?: string; plan?: ProbePlan; tech?: TechHit[] }

/** The fingerprints' folder: next to the app when installed, in the project's resources while developing. */
const setDir = () => (app.isPackaged ? join(process.resourcesPath, 'webappanalyzer') : join(app.getAppPath(), 'resources', 'webappanalyzer'))

/**
 * The site's technologies, by the fingerprints, in a process of its own (techWorker.ts): the probe's plan asked
 * once (kept), then one run per page — one at a time per tab (a page left before its answer — the old run ends).
 */
export class TechDetector {
  private readonly runs: ProcessSupervisor<Outcome>
  private plan?: Promise<ProbePlan | undefined>

  constructor(workerPath: string) {
    this.runs = new ProcessSupervisor<Outcome>({
      script: () => workerPath,
      serviceName: 'Qvarch Inspector',
      memoryMb: 512,
      failure: (error) => ({ ok: false, error }),
      stop: { kind: 'kill' },
      restart: 'kill',
    })
  }
  private run(id: string, job: unknown): Promise<Outcome> {
    return this.runs.start(id, {
      job,
      timeoutSec: 30,
      timeoutError: 'Определение технологий заняло слишком долго',
      onMessage: (m, run) => {
        const r = m as Outcome & { type?: string }
        if (r.type === 'done') run.finish(r)
      },
      exitError: (code) => `Процесс определения технологий завершился (${code ?? 0})`,
    })
  }
  /** What the page must be asked (the globals, the selectors) — from the set, once. */
  probePlan(): Promise<ProbePlan | undefined> {
    this.plan ??= this.run('plan', { type: 'plan', dir: setDir() }).then((r) => {
      if (!r.ok) this.plan = undefined
      return r.plan
    })
    return this.plan
  }
  /** A page's technologies (`key` — its tab: a newer page of it ends the older run). */
  async detect(key: string, signals: TechSignals): Promise<TechHit[]> {
    const r = await this.run(`detect:${key}`, { type: 'detect', dir: setDir(), signals })
    return r.tech ?? []
  }
}
