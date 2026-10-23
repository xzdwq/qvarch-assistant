import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { basename, dirname, join } from 'node:path'
import vm from 'node:vm'
import { BUILTIN_VARS, builtinValues, VAR_NAME, type BuiltinVarFacts, type TermInfo, type TermVar } from '../../shared/terminal'
import { findUp } from './projectInfo'

/** A JS insert's time limit (a formula, `{{ … }}`, `sh(…)`). */
const EVAL_LIMIT_MS = 5000

/** A value as it goes into a command: a regex match → its group (or the whole match); nothing → empty. */
export function insertText(v: unknown): string {
  if (Array.isArray(v)) v = v.length > 1 ? v[v.length - 1] : v[0]
  return v === null || v === undefined || v === false ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
}
/** A text with its `{{ js }}` inserts worked out in a scope; `empty` collects the inserts that came out empty (not the questions). */
export function fillInserts(text: string, ctx: vm.Context, empty?: string[]): string {
  return text.replace(/\{\{([\s\S]+?)\}\}/g, (_, expr: string) => {
    try {
      const v = insertText(vm.runInContext(`(${expr})`, ctx, { timeout: EVAL_LIMIT_MS }))
      if (!v && empty && !/\bask\s*\(/.test(expr)) empty.push(expr.trim())
      return v
    } catch (e) {
      throw new Error(`{{${expr.trim()}}}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
}

/** Where the variables are worked out: the shell's folder and line, one's own variables, the shell program for `sh(…)`. */
export interface VariableSource {
  cwd: string
  info?: TermInfo
  vars: TermVar[]
  shell: string
}

/** The lock files by package manager, in the order they are looked for. */
const LOCK_FILES = [
  ['pnpm', 'pnpm-lock.yaml'],
  ['yarn', 'yarn.lock'],
  ['npm', 'package-lock.json'],
] as const

/** What the built-in variables are worked out from, for a shell's folder and line (the project read from disk). */
function builtinFacts({ cwd, info }: VariableSource): BuiltinVarFacts {
  let pkg: unknown
  const pkgFile = findUp(cwd, 'package.json')
  try {
    pkg = pkgFile ? JSON.parse(readFileSync(pkgFile, 'utf8')) : undefined
  } catch {
    pkg = undefined
  }
  const root = pkgFile ? dirname(pkgFile) : cwd
  const lockfile = LOCK_FILES.find(([, file]) => existsSync(join(root, file)))?.[0] ?? ''
  return { cwd, dir: basename(cwd), info, now: new Date(), user: userInfo().username, pkg, lockfile, env: process.env }
}

/** The built-in variables for a shell, then one's own (each sees those above it); ask(…) → the answers given. */
export function variableScope(src: VariableSource, answers: Record<string, string>): vm.Context {
  const { cwd } = src
  const ctx = vm.createContext({
    ...builtinValues(builtinFacts(src)),
    ask: (label: string, def = '') => answers[label] ?? def,
    /** The output of a command in this folder (5 s at most). */
    sh: (command: string) => {
      try {
        return execFileSync(src.shell, ['-NoProfile', '-NoLogo', '-Command', command], { cwd, timeout: EVAL_LIMIT_MS, windowsHide: true, encoding: 'utf8' }).trim()
      } catch (e) {
        throw new Error(`sh(${command}): ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
      }
    },
  })
  for (const v of src.vars) {
    if (!VAR_NAME.test(v.name)) continue
    try {
      ctx[v.name] = v.js ? vm.runInContext(`(${v.value || 'undefined'})`, ctx, { timeout: EVAL_LIMIT_MS }) : fillInserts(v.value, ctx)
    } catch (e) {
      throw new Error(`${v.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return ctx
}

/**
 * A preset's command with its `{{ … }}` worked out (JS over the variables; ask(…) → the answers given), and the
 * inserts that came out empty (not the questions — an empty answer is meant).
 */
export function renderPreset(src: VariableSource, cmd: string, answers: Record<string, string>): { text: string; empty: string[] } {
  const empty: string[] = []
  const text = fillInserts(cmd, variableScope(src, answers), empty)
  return { text, empty }
}

/** Every variable's value for a shell, as text (or its error) — shown next to the variables. */
export function variableValues(src: VariableSource): Record<string, { value?: string; error?: string }> {
  const out: Record<string, { value?: string; error?: string }> = {}
  const asks: Record<string, string> = new Proxy({}, { get: (_t, k) => `‹${String(k)}›` })
  let ctx: vm.Context
  try {
    ctx = variableScope(src, asks)
  } catch (e) {
    // one's own variable failed: the ones before it worked, it has the error
    const msg = e instanceof Error ? e.message : String(e)
    const bad = msg.split(':')[0]
    for (const v of src.vars) {
      if (v.name === bad) {
        out[v.name] = { error: msg.slice(bad.length + 2) }
        break
      }
      out[v.name] = { value: '…' }
    }
    return out
  }
  // the built-in ones first (shown short), then one's own
  for (const b of BUILTIN_VARS) {
    const v = ctx[b.name]
    out[b.name] = { value: b.show?.(v) ?? insertText(v).slice(0, 200) }
  }
  for (const v of src.vars) out[v.name] = VAR_NAME.test(v.name) ? { value: insertText(ctx[v.name]).slice(0, 200) } : { error: 'имя — латиница, цифры, _ и $, не с цифры' }
  return out
}
