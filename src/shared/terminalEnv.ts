/**
 * A new shell's environment as Windows makes it at sign-in — the system's variables, then the user's (PATH: the
 * system's and then the user's), read anew for every shell as Windows Terminal does: a tool installed meanwhile is
 * there in the next tab, the app need not restart. What the app's own process has beyond them stays.
 */

/** A variable as the registry keeps it: its text, and whether its %VAR% are to be expanded (REG_EXPAND_SZ). */
export interface RegVar {
  value: string
  expand: boolean
}

/** A .reg export's text (`reg export`): its values by name — strings and expandable strings; anything else left out. */
export function parseRegExport(text: string): Map<string, RegVar> {
  const out = new Map<string, RegVar>()
  // (the export starts with a byte-order mark; a long value goes on over lines ending with «\»)
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (const line of body.replace(/\\\r?\n\s*/g, '').split(/\r?\n/)) {
    const m = /^"((?:[^"\\]|\\.)*)"=(.*)$/.exec(line)
    if (!m) continue
    const name = unescapeReg(m[1])
    const raw = m[2]
    if (raw.startsWith('"') && raw.endsWith('"')) out.set(name, { value: unescapeReg(raw.slice(1, -1)), expand: false })
    else if (raw.startsWith('hex(2):')) out.set(name, { value: utf16Hex(raw.slice(7)), expand: true })
  }
  return out
}
const unescapeReg = (s: string) => s.replace(/\\(.)/g, '$1')
/** hex(2): the value's UTF-16LE bytes, ending with a zero character. */
function utf16Hex(hex: string): string {
  const bytes = hex
    .split(',')
    .map((h) => parseInt(h.trim(), 16))
    .filter((n) => Number.isFinite(n))
  let s = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8))
  return s.replace(/\0+$/, '')
}

/** %NAME% put in from the variables there are (by name, any case); one not there stays as written. */
export function expandVars(s: string, env: Readonly<Record<string, string>>): string {
  return s.replace(/%([^%]+)%/g, (all, name: string) => valueOf(env, name) ?? all)
}
const keyOf = (env: Readonly<Record<string, string>>, name: string) => Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase())
const valueOf = (env: Readonly<Record<string, string>>, name: string) => {
  const k = keyOf(env, name)
  return k === undefined ? undefined : env[k]
}

/** A PATH as a shell finds things by it: its entries trimmed, the empty ones and the repeated ones (any case, a trailing «\») left out. */
export function cleanPath(path: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of path.split(';')) {
    const p = raw.trim()
    const key = p.replace(/[\\/]+$/, '').toLowerCase()
    if (!p || seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out.join(';')
}

/**
 * The environment a new shell starts with: the app's own (`base`), the system's variables over it, the user's over
 * those (each expanded against what is there by then); PATH — the system's, then the user's, cleaned. A name keeps
 * the case it has in `base` (Windows' names know no case).
 */
export function freshEnv(base: Readonly<Record<string, string>>, machine: ReadonlyMap<string, RegVar>, user: ReadonlyMap<string, RegVar>): Record<string, string> {
  const env: Record<string, string> = { ...base }
  const set = (name: string, value: string) => void (env[keyOf(env, name) ?? name] = value)
  const textOf = (v: RegVar) => (v.expand ? expandVars(v.value, env) : v.value)
  const pathOf = (vars: ReadonlyMap<string, RegVar>) => [...vars].find(([k]) => k.toLowerCase() === 'path')?.[1]
  for (const vars of [machine, user]) for (const [name, v] of vars) if (name.toLowerCase() !== 'path') set(name, textOf(v))
  const mp = pathOf(machine)
  const up = pathOf(user)
  if (mp || up) set('Path', cleanPath([mp ? textOf(mp) : '', up ? textOf(up) : ''].join(';')))
  else {
    const k = keyOf(env, 'path')
    if (k) env[k] = cleanPath(env[k])
  }
  return env
}
