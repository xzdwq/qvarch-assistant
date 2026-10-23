// Rules in the stylesheets beside components (<style scoped src>) that can style nothing: outside :deep(), a rule
// reaches only the app's own elements, so a class of its selector that no source names (in a class attribute or a
// string) means the rule is dead. Lists them; --fix removes them.
// Usage: node scripts/tailwind/deadRules.mjs [--fix]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss from 'postcss'
import { classNamesOf, sourceTexts } from './classNames.mjs'

const texts = sourceTexts()
const isNamed = classNamesOf(texts.values())
// the stylesheets a component points at
const sheets = new Set()
for (const [f, text] of texts) if (f.endsWith('.vue')) for (const m of text.matchAll(/<style\b[^>]*\bsrc="\.\/([^"]+)"/g)) sheets.add(join(f, '..', m[1]))
const fix = process.argv.includes('--fix')
let dead = 0
for (const sheet of sheets) {
  const root = postcss.parse(readFileSync(sheet, 'utf8'))
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return
    // per selector of the list: dead when outside :deep() it names a class no source does
    const live = rule.selectors.filter((sel) => {
      const own = sel.replace(/:deep\([^)]*\)/g, '')
      return [...own.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].every((m) => isNamed(m[1]))
      // (a CSS selector has no `_` for a space — unlike a utility's variant)
    })
    if (live.length === rule.selectors.length) return
    dead += rule.selectors.length - live.length
    console.log(`${sheet}: ${rule.selectors.filter((s) => !live.includes(s)).join(', ')}`)
    if (fix) live.length ? (rule.selectors = live) : rule.remove()
  })
  if (fix) {
    // wrappers left empty go too
    root.walkAtRules((at) => void (at.nodes && !at.nodes.length && at.remove()))
    writeFileSync(sheet, root.toString())
  }
}
console.log(`${dead} dead selectors`)
