import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Every stylesheet of the app (its own — not the libraries'). */
function sheets(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? sheets(p) : n.endsWith('.css') ? [p] : []
  })
}
/** The @imports that come after another rule: CSS drops them, and all they bring (a theme's colours) with them. */
function lateImports(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  let rules = false
  for (const m of code.matchAll(/@import[^;]*;|@charset[^;]*;|@layer[^;{]*;|[^\s;][^;{}]*\{/g)) {
    const t = m[0]
    if (t.startsWith('@import')) rules && out.push(t)
    else if (!t.startsWith('@charset') && !t.startsWith('@layer')) rules = true
  }
  return out
}

describe('stylesheets', () => {
  it('every @import before any rule', () => {
    expect(lateImports("@import 'a.css';\n@font-face { x: 1 }\n@import 'b.css' layer(base);")).toEqual(["@import 'b.css' layer(base);"])
    const bad = sheets(fileURLToPath(new URL('../../src', import.meta.url))).flatMap((f) => lateImports(readFileSync(f, 'utf8')).map((i) => `${f}: ${i}`))
    expect(bad).toEqual([])
  })
})
