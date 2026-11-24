import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectTech, probePlan, type RawTech, type TechSignals } from '../../../shared/browser/inspect/techEngine'

/**
 * The technologies' fingerprints (webappanalyzer, GPL-3.0) matched in a process of its own — the 7 700 technologies'
 * thousands of patterns never slow the app. One job a run: the probe's plan, or the technologies of a page.
 */
type Job = { type: 'plan'; dir: string } | { type: 'detect'; dir: string; signals: TechSignals }

const port = process.parentPort

/** The set as its files have it: technologies/*.json and categories.json. */
function readSet(dir: string): { techs: Record<string, RawTech>; cats: Record<string, { name: string }> } {
  const techs: Record<string, RawTech> = {}
  const tdir = join(dir, 'technologies')
  for (const f of readdirSync(tdir)) if (f.endsWith('.json')) Object.assign(techs, JSON.parse(readFileSync(join(tdir, f), 'utf8')) as Record<string, RawTech>)
  const cats = JSON.parse(readFileSync(join(dir, 'categories.json'), 'utf8')) as Record<string, { name: string }>
  return { techs, cats }
}

port.on('message', (e: { data: Job }) => {
  const j = e.data
  try {
    const set = readSet(j.dir)
    if (j.type === 'plan') port.postMessage({ type: 'done', ok: true, plan: probePlan(set.techs) })
    else port.postMessage({ type: 'done', ok: true, tech: detectTech(set.techs, set.cats, j.signals) })
  } catch (err) {
    port.postMessage({ type: 'done', ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
