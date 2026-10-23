// What the conversion would leave behind, over many components (a dry run): the rules kept in <style>, the rules
// that matched no element, the order-sensitive pairs.
// Usage: node scripts/tailwind/survey.mjs <file.vue | dir>... [--full]
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { convertFile } from './convert.mjs'

const full = process.argv.includes('--full')
/** Every .vue file under the given paths. */
function vueFiles(p) {
  if (statSync(p).isFile()) return p.endsWith('.vue') ? [p] : []
  return readdirSync(p).flatMap((n) => vueFiles(join(p, n)))
}
const files = process.argv.slice(2).filter((a) => !a.startsWith('--')).flatMap(vueFiles)
const totals = { files: 0, rules: 0, moved: 0, foreign: 0, kept: 0, unmatched: 0, orderSensitive: 0 }
for (const f of files) {
  let r
  try {
    r = convertFile(f, { dry: true })
  } catch (e) {
    console.log(`${f}: ERROR ${e.message}`)
    continue
  }
  if (r.skipped || !r.rules) continue
  totals.files++
  totals.rules += r.rules
  totals.moved += r.moved
  totals.foreign += r.foreign
  r.orderSensitive = [...new Set(r.orderSensitive)]
  totals.kept += r.kept.length
  totals.unmatched += r.unmatched.length
  totals.orderSensitive += r.orderSensitive.length
  console.log(`${f}: ${r.moved}/${r.rules} moved, ${r.foreign} foreign, ${r.kept.length} kept, ${r.unmatched.length} unmatched, ${r.orderSensitive.length} order`)
  if (full) {
    for (const k of r.kept) console.log(`    kept: ${k}`)
    for (const u of r.unmatched) console.log(`    unmatched: ${u}`)
    for (const o of r.orderSensitive) console.log(`    order: ${o}`)
  }
}
console.log(JSON.stringify(totals))
