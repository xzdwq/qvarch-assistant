import { needsPassword } from '../../../shared/ssh/api'
import type { ShellValue } from '../../../shared/shell/output'
import { trustVerdict } from '../../../shared/shell/trust'
import { scriptEnv, shellKindOf, shellTemplate } from '../../../shared/shell/shells'
import { infoMd, matchOf } from '../../domain/blockInfo'
import { resolvePath } from '../../domain/values'
import type { BlockRunner } from '../../engine/blockRunner'
import { cutText, tookText } from '../../engine/reportText'
import { runApi } from '../../engine/runApi'
import type { BlockItem } from '../../engine/runItems'
import type { RunEnv } from '../../engine/runEnv'
import { askShellApproval, cancelShellApproval, connectSsh } from '../../engine/shellApproval'
import { LatestRuns, trackedRun } from '../../engine/trackedRun'
import { beginLive, endLive } from '../../engine/shellLive'
import { liveValue } from '../../engine/shellValueLive'

/** Shell runs going on (run again before the first ended — the first one's answer is dropped, its process killed). */
const latest = new LatestRuns()

/** What the person's say means for the run: go on, or the error it ends with. */
const ANSWER_ERROR: Record<'no' | 'timeout', string> = {
  no: 'Запуск не разрешён',
  timeout: 'Не одобрено за 10 минут — запуск отменён',
}

/**
 * The script allowed to run: approved before — yes; otherwise (or the block asks always) the person is asked;
 * «Разрешить и запомнить» — approved for good. An error text when it may not run.
 */
async function allowed(env: RunEnv, item: BlockItem, slot: string): Promise<string | undefined> {
  const trust = await runApi().shellTrust({ notePath: env.notePath, infoLine: infoMd(item.info), body: item.body })
  const ask = item.info.ask ?? 'auto'
  if (trustVerdict(ask, trust.approved) === 'run') return undefined
  // (the script as approved: its {{ }} stay — their values reach it as variables, never as its code)
  const answer = await askShellApproval({ notePath: env.notePath, block: item.info.name ?? item.key, lang: item.info.lang, script: item.body, ssh: item.info.ssh, why: ask === 'always' ? 'always' : 'new' }, slot)
  if (answer === 'always') await runApi().shellApprove(trust.fingerprint)
  return answer === 'always' || answer === 'once' ? undefined : ANSWER_ERROR[answer]
}

/**
 * A shell block run: its {{ values }} filled, its script allowed (asked when needed), run on this PC or on its SSH
 * session's server (a password asked when the connection needs one, then once more); its value — exit code, streams,
 * lines, matches — published under its name even when the exit code is not 0 (a condition may read it).
 */
export const shellRunner: BlockRunner = {
  run({ env, item }) {
    const ctx = env.values()
    const kind = shellKindOf(item.info.lang) ?? 'powershell'
    // {{ x }} → the shell's variable holding x's value: a value is never the script's code
    const filled = shellTemplate(kind, item.body, (path) => resolvePath(ctx, path))
    return trackedRun(latest, env, item.key, { state: 'run', at: Date.now() }, async ({ slot }) => {
      if (filled.missing.length) return { ok: false, run: { error: `Нет значений: ${filled.missing.join(', ')}` } }
      const vars = scriptEnv(filled.script, ctx, filled.vars)
      if ('error' in vars) return { ok: false, run: { error: vars.error } }
      const refused = await allowed(env, item, slot)
      if (refused) return { ok: false, run: { error: refused } }
      const job = { lang: item.info.lang, script: filled.script, env: vars.env, cwd: item.info.cwd, ssh: item.info.ssh, tty: item.info.ssh && item.info.tty ? true : undefined, match: matchOf(item.info.match), timeoutSec: item.info.timeout }
      // its value grows while it runs (the note's own runs: a loop's pass keeps its values to itself)
      const growing = item.info.name && env.root === env ? liveValue(env.notePath, item.info.name, item.key, job.match) : undefined
      beginLive(slot, env.notePath, item.key, growing?.feed)
      let r
      try {
        r = await runApi().runShell(slot, job)
        if (!r.ok && item.info.ssh && r.error && needsPassword(r.error) && (await connectSsh(item.info.ssh))) r = await runApi().runShell(slot, job)
      } finally {
        endLive(slot)
        growing?.end(r?.value)
      }
      const value = r.value
      return {
        ok: r.ok,
        run: { ms: r.ms, error: r.error, value, hasValue: !!value, logs: [] },
        publish: () => value && item.info.name && env.publish(item.info.name, value, 'shell', item.key),
      }
    })
  },
  stop: (env, key) => {
    // (waiting for the person's say: the question taken back — nothing runs)
    cancelShellApproval(env.runSlot(key))
    runApi().runShellStop(env.runSlot(key))
  },
  resultOf: (run) => (run.hasValue ? run.value : undefined),
  reportHeadline: (r) => {
    const v = r.value as ShellValue | undefined
    return `${r.state === 'ok' ? 'выполнен' : 'ошибка'}${v ? ` · код ${v.exitCode}` : ''}${tookText(r.ms)}`
  },
  reportDetails: (r, { body, brief }) => {
    const v = r.value as ShellValue | undefined
    const out = brief ? [] : [`Скрипт: ${cutText(body.trim(), 300)}`]
    if (!brief && v?.stdout) out.push(`Вывод: ${cutText(v.stdout.trim(), 1500)}`)
    return out
  },
}
