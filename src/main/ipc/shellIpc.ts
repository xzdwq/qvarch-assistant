import { createHash } from 'node:crypto'
import { shellFingerprint } from '../../shared/shell/trust'
import type { AppContext } from '../app/appContext'
import { ProcessSupervisor } from '../process/processSupervisor'
import { ShellApprovals } from '../shell/shellApprovals'
import { ShellRuns, type ShellJob, type ShellRunResult } from '../shell/shellRuns'
import { emit, handle, listen } from './router'

/**
 * The notebook's shell blocks: a script run on this PC (a worker under its supervisor) or on an SSH server (the
 * session's connection), its output live to the window; the approved scripts' fingerprints. Returns the stop of all.
 */
export function registerShellIpc(app: AppContext): (reason: string) => void {
  const local = new ProcessSupervisor<ShellRunResult>({
    script: () => app.script('shellWorker.js'),
    serviceName: 'Qvarch Shell',
    memoryMb: 256,
    failure: (error, ms) => ({ ok: false, error, ms }),
    // asked first: the worker kills the shell's whole tree, then ends
    stop: { kind: 'ask', message: { type: 'stop' }, graceMs: 3000 },
    restart: 'kill',
  })
  const runs = new ShellRuns(
    local,
    () => app.ssh?.connections,
    (to, runId, stream, chunk) => !to.isDestroyed() && emit(to, 'onShellOut', runId, stream, chunk),
  )
  const approvals = new ShellApprovals(app.store.root)
  handle('runShell', (e, runId, job) => runs.run(String(runId), cleanJob(job), e.sender))
  listen('runShellStop', (_e, runId) => runs.stop(String(runId)))
  handle('shellTrust', (_e, s) => {
    const fingerprint = shellFingerprint(String(s?.notePath ?? ''), String(s?.infoLine ?? ''), String(s?.body ?? ''), sha256)
    return { fingerprint, approved: approvals.has(fingerprint) }
  })
  handle('shellApprove', (_e, fp) => approvals.add(String(fp)))
  return (reason) => runs.stopAll(reason)
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** A job as the window sent it: only its known fields, of the right shape. */
function cleanJob(j: Partial<ShellJob> | undefined): ShellJob {
  const m = j?.match
  return {
    lang: String(j?.lang ?? ''),
    script: String(j?.script ?? ''),
    // (only QA_* text variables: nothing else reaches a shell's environment)
    env: Object.fromEntries(Object.entries(j?.env && typeof j.env === 'object' ? j.env : {}).filter(([k, v]) => /^QA_\w+$/.test(k) && typeof v === 'string')),
    cwd: typeof j?.cwd === 'string' ? j.cwd : undefined,
    ssh: typeof j?.ssh === 'string' && j.ssh ? j.ssh : undefined,
    match: m && typeof m.source === 'string' ? { source: m.source, flags: String(m.flags ?? '') } : undefined,
    timeoutSec: Number(j?.timeoutSec) || undefined,
  }
}
