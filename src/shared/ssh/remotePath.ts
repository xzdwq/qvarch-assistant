/**
 * Paths on an SSH server, as SFTP gives them: always '/'-separated; a Windows server (OpenSSH) puts its drive after
 * the first slash ('/C:/Users').
 */

/** A path made plain: '/' only, no doubled or trailing slashes, '.' and '..' worked out (never above the root). */
export function normRemote(p: string): string {
  const parts: string[] = []
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      // a Windows drive is the root of its tree
      if (parts.length && !(parts.length === 1 && isDrive(parts[0]))) parts.pop()
      continue
    }
    parts.push(seg)
  }
  return `/${parts.join('/')}`
}
const isDrive = (seg: string) => /^[A-Za-z]:$/.test(seg)

/** A name or a path joined to a folder (an absolute one stands for itself). */
export function joinRemote(dir: string, name: string): string {
  return normRemote(name.startsWith('/') ? name : `${dir}/${name}`)
}

/** The folder a path is in (the root, a drive — itself). */
export function parentRemote(p: string): string {
  const n = normRemote(p)
  const parts = n.split('/').filter(Boolean)
  if (!parts.length || (parts.length === 1 && isDrive(parts[0]))) return n
  return normRemote(`/${parts.slice(0, -1).join('/')}`)
}

/** The last part of a path ('' for the root). */
export const baseRemote = (p: string) => normRemote(p).split('/').filter(Boolean).pop() ?? ''

/** A path as crumbs, the root first: '/var/log' → '/', 'var', 'log'; '/C:/Users' → 'C:', 'Users'. */
export function remoteCrumbs(p: string): Array<{ name: string; path: string }> {
  const parts = normRemote(p).split('/').filter(Boolean)
  const out: Array<{ name: string; path: string }> = isDrive(parts[0] ?? '') ? [] : [{ name: '/', path: '/' }]
  parts.forEach((name, i) => out.push({ name, path: `/${parts.slice(0, i + 1).join('/')}` }))
  return out
}

/** A file name a local disk takes: Windows' forbidden characters replaced, reserved names and trailing dots avoided. */
export function localSafeName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '')
  const safe = cleaned || '_'
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(safe) ? `_${safe}` : safe
}
