import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { commandOf, viaShell, type ClaudeBin } from './claudePath'

/**
 * The options of Claude Code a turn is run with when this one takes them (an older one lacks some — run without
 * them, never failing on «unknown option»): read once from its `--help`, again when its file changes (an update).
 */
export const CLAUDE_FLAGS = ['--tools', '--exclude-dynamic-system-prompt-sections'] as const
export type ClaudeFlag = (typeof CLAUDE_FLAGS)[number]

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
/** The flags its help names (as an option: «--tools» is not «--allowedTools» nor «--disallowed-tools»). */
export const flagsIn = (help: string): Set<ClaudeFlag> => new Set(CLAUDE_FLAGS.filter((f) => new RegExp(`(^|[\\s,])${escaped(f)}(?=[\\s,=<]|$)`, 'm').test(help)))

const known = new Map<string, Set<ClaudeFlag>>()
const keyOf = (bin: ClaudeBin): string => {
  try {
    return `${bin.file}|${statSync(bin.file).mtimeMs}`
  } catch {
    return bin.file
  }
}
/** The flags this Claude Code takes (its help not read — none: the turn runs as before, only dearer). */
export async function claudeFlags(bin: ClaudeBin): Promise<ReadonlySet<ClaudeFlag>> {
  const key = keyOf(bin)
  const had = known.get(key)
  if (had) return had
  const help = await new Promise<string | undefined>((ok) =>
    execFile(commandOf(bin), ['--help'], { shell: viaShell(bin), windowsHide: true, timeout: 30_000, env: bin.env }, (e, out) => ok(e ? undefined : String(out))),
  )
  const flags = help === undefined ? new Set<ClaudeFlag>() : flagsIn(help)
  // (a failed read is asked again next turn)
  if (help !== undefined) known.set(key, flags)
  return flags
}
