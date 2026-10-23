// Every component under the given folders moved to Tailwind (convert.mjs on each), with a summary of what stayed CSS.
// Two passes: a dry one learns each component's own declarations on its root (a parent's rule there is weighed
// against them), the second converts.
// Usage: node scripts/tailwind/convertAll.mjs <dir>...
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { convertFile } from './convert.mjs'

const walk = (p) => (statSync(p).isFile() ? [p] : readdirSync(p).flatMap((n) => walk(join(p, n))))
const files = process.argv.slice(2).flatMap(walk).filter((f) => f.endsWith('.vue'))
const childDecls = new Map()
for (const f of files) {
  const r = convertFile(f, { dry: true })
  if (r.rootDecls?.length) childDecls.set(resolve(f), r.rootDecls)
}
for (const f of files) {
  const r = convertFile(f, { childDecls })
  if (r.skipped || !r.rules) continue
  const order = [...new Set(r.orderSensitive)]
  console.log(`${f}: ${r.moved}/${r.rules} moved${r.kept.length ? `, ${r.kept.length} stay CSS` : ''}${order.length ? `, check: ${order.join(' | ')}` : ''}`)
}
