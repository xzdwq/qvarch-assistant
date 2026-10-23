import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TermInfo } from '../../shared/terminal'

/** The nearest file of this name in a folder or above it. */
export function findUp(cwd: string, name: string): string | undefined {
  let d = cwd
  for (;;) {
    const f = join(d, name)
    if (existsSync(f)) return f
    const up = dirname(d)
    if (up === d) return undefined
    d = up
  }
}

/** The git repository a folder is in, and its branch (read from .git, no process). */
export function gitHere(cwd: string): { root: string; branch: string } | undefined {
  let d = cwd
  for (;;) {
    const g = join(d, '.git')
    if (existsSync(g)) {
      try {
        let dir = g
        // a worktree / a submodule: .git is a file "gitdir: …"
        if (statSync(g).isFile()) dir = readFileSync(g, 'utf8').replace(/^gitdir:\s*/, '').trim()
        const head = readFileSync(join(dir, 'HEAD'), 'utf8').trim()
        const m = head.match(/^ref:\s*refs\/heads\/(.+)$/)
        return { root: d, branch: m ? m[1] : head.slice(0, 7) }
      } catch {
        return undefined
      }
    }
    const up = dirname(d)
    if (up === d) return undefined
    d = up
  }
}

/** How many files are changed in a repository (undefined — git failed). */
function gitDirty(root: string): Promise<number | undefined> {
  return new Promise((res) =>
    execFile('git', ['-C', root, 'status', '--porcelain'], { timeout: 4000, windowsHide: true }, (err, out) => res(err ? undefined : String(out).split('\n').filter(Boolean).length)),
  )
}

/** The versions of the tools the shells run, by their paths (a known path is asked once). */
export class ToolVersions {
  private readonly known = new Map<string, string>()

  /** A tool's version (`-v`), or undefined when it does not answer. */
  of(path: string): Promise<string | undefined> {
    const hit = this.known.get(path)
    if (hit) return Promise.resolve(hit)
    return new Promise((res) => {
      // .cmd shims (npm, pnpm) need the shell
      execFile(path, ['-v'], { timeout: 6000, windowsHide: true, shell: /\.(cmd|bat)$/i.test(path) }, (err, out) => {
        const v = err ? undefined : String(out).trim().replace(/^v/, '').split(/\s+/)[0]
        if (v) this.known.set(path, v)
        res(v)
      })
    })
  }
}

/**
 * The line over the terminal for a folder: the git branch and changes, the package (name, version, the node it
 * wants, its package manager) and the versions of node / npm / pnpm the shell would run (its PATH — fnm / nvm included).
 */
export async function readProjectInfo(cwd: string, tools: Array<string | undefined>, versions: ToolVersions): Promise<TermInfo> {
  const info: TermInfo = { cwd }
  const git = gitHere(cwd)
  if (git) {
    info.branch = git.branch
    info.dirty = await gitDirty(git.root)
  }
  const pkg = findUp(cwd, 'package.json')
  if (pkg) {
    try {
      const j = JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string; version?: string; engines?: { node?: string }; packageManager?: string }
      const wanted = [findUp(cwd, '.nvmrc'), findUp(cwd, '.node-version')].map((f) => (f ? readFileSync(f, 'utf8').trim() : '')).find(Boolean)
      info.project = { name: j.name, version: j.version, nodeWanted: wanted || j.engines?.node, packageManager: j.packageManager }
    } catch {
      info.project = {}
    }
  }
  const [node, npm, pnpm] = tools
  if (node) info.node = await versions.of(node)
  if (pkg || node) {
    if (npm) info.npm = await versions.of(npm)
    if (pnpm) info.pnpm = await versions.of(pnpm)
  }
  return info
}
