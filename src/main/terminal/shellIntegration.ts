/**
 * How the app talks with PowerShell without a side channel: the prompt is wrapped to print a hidden mark (the folder,
 * where node / npm / pnpm are, the last history entry, how the last command ended), and PSReadLine reports the
 * accepted command line. Both come in the output as OSC 633 sequences, which the terminal does not draw.
 */

/** The prompt's mark: `ESC ] 633 ; QV ; <fields> BEL`. */
export const PROMPT_MARK = /\x1b\]633;QV;([^\x07]*)\x07/g
/** The prompt mark's start (where the command's output ends). */
export const PROMPT_MARK_START = '\x1b]633;QV;'
/** Any of the app's marks starts so (one may be split between two chunks). */
export const MARK_START = '\x1b]633;Q'
/** The command line was accepted — what follows is the command's output (not the echo of the typing). */
export const COMMAND_ACCEPTED = '\x1b]633;QC\x07'
/** Ctrl+C's exit code on Windows (STATUS_CONTROL_C_EXIT) — stopped by hand, not a failure. */
const CTRL_C_EXIT = new Set([-1073741510, 3221225786, 130])

/** An exit code that means «stopped with Ctrl+C». */
export const isCtrlCExit = (code: number): boolean => CTRL_C_EXIT.has(code)

/**
 * Wraps whatever prompt the profile made (oh-my-posh…): first a hidden mark with the folder, the tools, the last
 * history entry and how the command ended. `$?` is put back before the original prompt runs (it shows errors too).
 */
const INIT = `
$global:__qvOrig = $function:prompt
function global:prompt {
  $qvOk = $global:?
  $qvCode = $global:LASTEXITCODE
  Set-StrictMode -Off
  $qvH = (Get-History -Count 1).Id
  $p = $executionContext.SessionState.Path.CurrentLocation.ProviderPath
  $t = foreach ($c in 'node','npm','pnpm') { (Get-Command $c -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source }
  $m = "$([char]27)]633;QV;$p|$($t -join '|')|$qvH|$([int]$qvOk)|$qvCode$([char]7)"
  if (-not $qvOk) { Write-Error 'qv' -ErrorAction Ignore }
  $o = & $global:__qvOrig
  "$m$o"
}
# the accepted command line is reported (like VS Code's shell integration): the typing's echo ends there
if (-not (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue)) { Import-Module PSReadLine -ErrorAction SilentlyContinue }
if (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue) {
  $global:__qvRead = $function:PSConsoleHostReadLine
  function global:PSConsoleHostReadLine {
    $l = & $global:__qvRead
    [Console]::Write("$([char]27)]633;QC$([char]7)")
    $l
  }
  # Ctrl+A: the whole typed line selected — PSReadLine's own selection (typing / Delete replace it) and the
  # window's (shown, Ctrl+C copies it): the line's length and the cursor's place go to the window
  Set-PSReadLineKeyHandler -Chord 'Ctrl+a' -BriefDescription 'QvSelectAll' -ScriptBlock {
    $qvB = $null
    $qvC = $null
    [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$qvB, [ref]$qvC)
    [Console]::Write("$([char]27)]633;QA;$($qvB.Length);$qvC$([char]7)")
    [Microsoft.PowerShell.PSConsoleReadLine]::SelectAll()
  }
}
`
/** What the shells must not inherit: NO_COLOR would make oh-my-posh and the tools colourless. */
const DROP_ENV = /^(NO_COLOR|ELECTRON_RUN_AS_NODE|ELECTRON_NO_ATTACH_CONSOLE|GIT_TERMINAL_PROMPT)$/i

/** PowerShell's arguments: no logo, the profile or not, the prompt wrapper run first. */
export function shellArgs(loadProfile: boolean): string[] {
  return ['-NoLogo', ...(loadProfile ? [] : ['-NoProfile']), '-NoExit', '-EncodedCommand', Buffer.from(INIT, 'utf16le').toString('base64')]
}
/** The shell's environment: the app's own, without what spoils it, marked as this terminal with true colour. */
export function shellEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !DROP_ENV.test(k)) out[k] = v
  out.TERM_PROGRAM = 'qvarch'
  out.COLORTERM = 'truecolor'
  return out
}

/** What a prompt mark tells. */
export interface PromptMark {
  cwd: string
  /** Where node / npm / pnpm are for this shell (its PATH), if anywhere. */
  tools: [string | undefined, string | undefined, string | undefined]
  /** The last history entry's id ('' — none yet). */
  historyId?: string
  /** `$?` of the last command: '1' — fine, '0' — failed. */
  ok?: string
  /** `$LASTEXITCODE` as text. */
  code?: string
}
/** A prompt mark's fields (`cwd|node|npm|pnpm|history|ok|code`). */
export function parsePromptMark(fields: string): PromptMark {
  const [cwd, node, npm, pnpm, historyId, ok, code] = fields.split('|')
  return { cwd, tools: [node, npm, pnpm], historyId, ok, code }
}
/** The last prompt mark in a piece of output, if any. */
export function lastPromptMark(text: string): PromptMark | undefined {
  let last: string | undefined
  for (const m of text.matchAll(PROMPT_MARK)) last = m[1]
  return last === undefined ? undefined : parsePromptMark(last)
}
/** The unfinished mark at the end of a chunk (it continues in the next one), or ''. */
export function openMarkTail(text: string): string {
  const open = text.lastIndexOf(MARK_START)
  return open >= 0 && text.indexOf('\x07', open) < 0 ? text.slice(open) : ''
}
/**
 * How a command ended, by its prompt mark: the exit code of a failure, or undefined (fine, or stopped with Ctrl+C —
 * by the key pressed while it ran or by its exit code).
 */
export function commandFailure(mark: PromptMark, interrupted: boolean): number | undefined {
  const n = Number(mark.code)
  const failed = mark.ok === '0' && !interrupted && !isCtrlCExit(n)
  return failed ? (Number.isFinite(n) && n !== 0 ? n : 1) : undefined
}
