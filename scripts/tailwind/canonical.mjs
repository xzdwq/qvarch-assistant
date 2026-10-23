// The utilities in the components rewritten in Tailwind's own shortest equivalent form (`tw:bg-[color:rgba(…)]` →
// `tw:bg-[rgba(…)]`, `tw:[font-weight:600]` → `tw:font-semibold`); classes inside static class="…" only.
// Usage: node scripts/tailwind/canonical.mjs <dir>... [--dry]
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { __unstable__loadDesignSystem } from '@tailwindcss/node'

const cssPath = resolve('src/renderer/src/styles/tailwind.css')
const ds = await __unstable__loadDesignSystem(readFileSync(cssPath, 'utf8'), { base: dirname(cssPath) })
const dry = process.argv.includes('--dry')
const walk = (p) => (statSync(p).isFile() ? [p] : readdirSync(p).flatMap((n) => walk(join(p, n))))
const files = process.argv.slice(2).filter((a) => !a.startsWith('--')).flatMap(walk).filter((f) => f.endsWith('.vue'))
let changed = 0
const samples = []
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  const out = text.replace(/(\sclass=")([^"]*)(")/g, (_, a, v, b) => {
    const tokens = v.split(/(\s+)/)
    const next = tokens.map((t) => {
      if (!t.startsWith('tw:')) return t
      const [c] = ds.canonicalizeCandidates([t])
      // only a form that still compiles to the same CSS
      if (!c || c === t) return t
      const [was, now] = ds.candidatesToCss([t, c])
      // the same declarations under the same conditions (the class name itself and spacing aside)
      const body = (css) => css?.replace(/\.(?:\\.|[^\s{,:\\])+/g, '.x').replace(/\s+/g, '')
      if (!was || body(was) !== body(now)) return t
      changed++
      if (samples.length < 25) samples.push(`${t} → ${c}`)
      return c
    })
    return a + next.join('') + b
  })
  if (out !== text && !dry) writeFileSync(f, out)
}
console.log(`${changed} utilities rewritten`)
console.log(samples.join('\n'))
