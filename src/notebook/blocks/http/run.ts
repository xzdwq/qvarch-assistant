import { kv, newRequest, type HttpMethod } from '../../../shared/http'
import { interpolate } from '../../domain/values'
import { LatestRuns, type BlockRunner } from '../../engine/blockRunner'
import { cutText, indentText, RUN_STATE_TEXT, tookText } from '../../engine/reportText'
import { errorText, runApi } from '../../engine/runApi'
import { saveRunsSoon } from '../../engine/runStore'
import { parseHttpText, publishedAnswer } from './httpText'

/** Requests going on (a request run again before the first answered — the first answer is dropped). */
const latest = new LatestRuns()

/**
 * A request block run: its {{ values }} filled from the env (the HTTP section's variables fill the rest), sent by the
 * main process; its answer kept and published under the block's name.
 */
export const httpRunner: BlockRunner = {
  async run({ env, item }) {
    const ctx = env.values()
    const p = parseHttpText(item.body)
    const missing: string[] = []
    const fill = (s: string) => {
      const r = interpolate(s, ctx)
      missing.push(...r.missing)
      return r.text
    }
    const url = fill(p.url)
    const headers = p.headers.map(([k, v]) => [k, fill(v)] as [string, string])
    const body = fill(p.body)
    const req = newRequest(item.info.name ?? 'Блок заметки')
    req.method = (p.method as HttpMethod) || 'GET'
    req.url = url
    req.headers = headers.map(([k, v]) => kv(k, v))
    const ctype = headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
    if (body) req.body = /json/i.test(ctype) || (!ctype && /^\s*[[{]/.test(body)) ? { mode: 'json', text: body, rawType: 'application/json', rows: [] } : { mode: 'raw', text: body, rawType: ctype || 'text/plain', rows: [] }
    const slot = env.runSlot(item.key)
    const runId = latest.begin(slot)
    const r = env.recordRun(item.key, { state: 'run', at: Date.now(), request: { method: req.method, url, headers, body, missing } })
    try {
      const doc = await runApi().httpLoad()
      const out = await runApi().httpRun(req, doc, runId)
      if (!latest.isLatest(slot, runId)) return false
      const ok = !out.error && !!out.response
      env.recordRun(item.key, { ...r, state: ok ? 'ok' : 'error', ms: out.response?.time, response: out.response, error: out.error, logs: out.logs.map((t) => ({ level: 'log', text: t })) })
      if (out.response && item.info.name) env.publish(item.info.name, publishedAnswer(out.response), 'http', item.key)
      saveRunsSoon(env.notePath)
      return ok
    } catch (e) {
      env.recordRun(item.key, { ...r, state: 'error', error: errorText(e) })
      saveRunsSoon(env.notePath)
      return false
    } finally {
      latest.end(slot, runId)
    }
  },
  stop(env, key) {
    const id = latest.current(env.runSlot(key))
    if (id) void runApi().httpAbort(id)
  },
  resultOf: (run) => (run.response ? publishedAnswer(run.response) : undefined),
  reportHeadline: (r) => `${r.response ? `${r.response.status} ${r.response.statusText}` : RUN_STATE_TEXT[r.state]}${tookText(r.ms)}`,
  reportDetails(r, { brief }) {
    const out = r.request ? [`${r.request.method} ${r.request.url}`] : []
    const res = r.response
    if (brief || !res) return out
    const type = res.headers.find(([h]) => h.toLowerCase() === 'content-type')?.[1]?.split(';')[0]
    out.push(`Ответ: ${res.size < 1024 ? `${res.size} Б` : `${(res.size / 1024).toFixed(1)} КБ`}${type ? `, ${type}` : ''}`)
    if (res.body) out.push(`Тело (начало):\n${indentText(cutText(res.body, 600))}`)
    return out
  },
  loopRow: (v) => {
    const a = v as { status?: number; time?: number; body?: unknown }
    return { status: a.status, time: a.time, body: a.body }
  },
}
