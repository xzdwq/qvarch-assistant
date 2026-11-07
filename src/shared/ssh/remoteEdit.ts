/** A server's text file opened in the explorer's editor: what may be opened, how it is highlighted, its backup's name. */

/** A file larger than this is not opened for editing (it is brought over and opened by Windows instead). */
export const TEXT_EDIT_MAX = 5 * 1024 * 1024
/** How much of a file is looked at to tell text from binary. */
export const TEXT_SNIFF = 8192

const pad = (n: number) => String(n).padStart(2, '0')
/** The backup's path: next to the file, `name.backup-YYYY-MM-DD_HH-MM-SS`. */
export function backupPath(path: string, now: Date): string {
  return `${path}.backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}

/** A file's start is text: no zero byte, valid UTF-8 (a letter cut at the sample's end is fine). */
export function looksText(sample: Uint8Array): boolean {
  if (sample.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true })
    return true
  } catch {
    return false
  }
}

/** The editor's highlighting by a file's extension (CodeArea's kinds); by a whole name for the ones without one. */
const BY_EXT: Readonly<Record<string, string>> = {
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  env: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  sql: 'sql',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  ts: 'typescript',
  md: 'markdown',
}
const BY_NAME: Readonly<Record<string, string>> = { dockerfile: 'bash', makefile: 'bash', '.bashrc': 'bash', '.profile': 'bash', '.zshrc': 'bash', '.env': 'bash' }
export function editorLang(name: string): string {
  const n = name.toLowerCase()
  if (Object.hasOwn(BY_NAME, n)) return BY_NAME[n]
  const ext = n.includes('.') ? n.slice(n.lastIndexOf('.') + 1) : ''
  return Object.hasOwn(BY_EXT, ext) ? BY_EXT[ext] : 'text'
}
