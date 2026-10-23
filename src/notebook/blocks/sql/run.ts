import { bindSql, rowsAsObjects } from '../../../shared/sql'
import { missingValuesError, resolvePath } from '../../domain/values'
import { LatestRuns, type BlockRunner } from '../../engine/blockRunner'
import { cutText, indentText, RUN_STATE_TEXT, tookText } from '../../engine/reportText'
import { errorText, runApi } from '../../engine/runApi'
import { saveRunsSoon } from '../../engine/runStore'

/** Queries going on (a query run again before the first answered — the first answer is dropped). */
const latest = new LatestRuns()

/**
 * A database query of the note: its {{ values }} sent as parameters (never glued into its text), run read-only in a
 * process of its own; its rows published under its name (an array of objects — {{ name[0].id }}). A plan (`plan`,
 * `analyze`) publishes nothing.
 */
export const sqlRunner: BlockRunner = {
  async run({ env, item, sqlMode = 'run' }) {
    const ctx = env.values()
    const db = item.info.db ?? ''
    const conn = (await runApi().sql('conns')).find((c) => c.name === db)
    const b = bindSql(item.body, conn?.kind ?? 'pg', (p) => resolvePath(ctx, p))
    const sql = { text: b.text, values: b.values, mode: sqlMode, db, missing: b.missing }
    const error = b.error ?? (b.missing.length ? missingValuesError(b.missing) : undefined)
    if (error) {
      env.recordRun(item.key, { state: 'error', at: Date.now(), sql, error })
      saveRunsSoon(env.notePath)
      return false
    }
    const slot = env.runSlot(item.key)
    const runId = latest.begin(slot)
    const r = env.recordRun(item.key, { state: 'run', at: Date.now(), sql })
    try {
      const out = await runApi().sql('run', runId, db, b.text, b.values, sqlMode)
      if (!latest.isLatest(slot, runId)) return false
      const x = out.run
      env.recordRun(item.key, { ...r, state: out.ok ? 'ok' : 'error', ms: out.ms, error: out.error, table: x?.result, plan: x?.plan, planRaw: x?.planRaw, server: x?.server })
      if (out.ok && x?.result && item.info.name) env.publish(item.info.name, rowsAsObjects(x.result), 'sql', item.key)
      saveRunsSoon(env.notePath)
      return out.ok
    } catch (e) {
      env.recordRun(item.key, { ...r, state: 'error', error: errorText(e) })
      saveRunsSoon(env.notePath)
      return false
    } finally {
      latest.end(slot, runId)
    }
  },
  stop(env, key) {
    // (a query: cancelled on its server, its connection closed)
    const id = latest.current(env.runSlot(key))
    if (id) void runApi().sql('stop', id)
  },
  resultOf: (run) => (run.table ? rowsAsObjects(run.table) : undefined),
  reportHeadline(r, { info }) {
    const t = r.table
    const what = t ? `строк ${t.rows.length}${t.more ? '+' : ''}` : r.plan ? 'план' : RUN_STATE_TEXT[r.state]
    return `${what}${tookText(r.ms)}${info.db ? ` · ${info.db}` : ''}`
  },
  reportDetails(r, { body, brief }) {
    if (brief) return []
    const out = [`Запрос:\n${indentText(cutText(body.trim(), 1500))}`]
    if (r.plan?.findings.length) out.push(`Замечания плана:\n${indentText(r.plan.findings.map((f) => `${f.level === 'warn' ? '⚠️' : 'ℹ️'} ${f.text}`).join('\n'))}`)
    return out
  },
}
