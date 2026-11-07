/**
 * A server's shell telling where it is: after sign-in a hook is typed in once (bash — PROMPT_COMMAND, zsh — precmd)
 * that prints OSC 7 (`ESC ] 7 ; file://host/path BEL`) at every prompt; then a mark that it took. Its echo is hidden
 * from the terminal; the folder follows each prompt (the explorer and the line over the terminal use it). Shells it
 * does not fit (fish, a router's CLI) — the mark never comes, nothing is known, nothing breaks.
 */

/** The mark the hook prints once it is set (an OSC no terminal acts on). */
export const HOOK_MARK = '\x1b]1337;QaCwdHook\x07'

/**
 * The line typed into the shell: a leading space keeps it out of the history (HISTCONTROL=ignorespace); the old
 * PROMPT_COMMAND is kept after ours; ends with the mark (printed — not echoed — so its ESC is real).
 */
export function cwdHookLine(): string {
  const osc = String.raw`\033]7;file://%s%s\007`
  return [
    ' if [ -n "$ZSH_VERSION" ]; then',
    ` __qa_cwd() { printf '${osc}' "$HOST" "$PWD"; }; precmd_functions+=(__qa_cwd);`,
    ' elif [ -n "$BASH_VERSION" ]; then',
    ` PROMPT_COMMAND='printf "${osc}" "$HOSTNAME" "$PWD"'"\${PROMPT_COMMAND:+;$PROMPT_COMMAND}";`,
    ` fi; printf '${String.raw`\033]1337;QaCwdHook\007`}'\r`,
  ].join('')
}

/** OSC 7's start; its end is BEL or ST (ESC \). */
const OSC7 = '\x1b]7;'

/** A file:// URL's path, decoded ('' when it is not one). */
export function pathOfFileUrl(url: string): string {
  const m = url.match(/^file:\/\/[^/]*(\/.*)$/)
  if (!m) return ''
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

/**
 * The folders a chunk of output tells (OSC 7), oldest first; an OSC 7 cut at the chunk's end is kept in `carry` for
 * the next one. The output itself passes on unchanged (a terminal ignores OSC 7).
 */
export function scanOsc7(carry: string, chunk: string): { cwds: string[]; carry: string } {
  const text = carry + chunk
  const cwds: string[] = []
  let at = 0
  for (;;) {
    const start = text.indexOf(OSC7, at)
    if (start < 0) break
    const bel = text.indexOf('\x07', start)
    const st = text.indexOf('\x1b\\', start)
    const end = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st)
    if (end < 0) return { cwds, carry: text.length - start > 4096 ? '' : text.slice(start) }
    const path = pathOfFileUrl(text.slice(start + OSC7.length, end))
    if (path) cwds.push(path)
    at = end + 1
  }
  // an ESC (or ESC ]…) at the very end may start the next OSC 7
  const tail = text.slice(Math.max(at, text.length - OSC7.length + 1))
  const cut = tail.lastIndexOf('\x1b')
  return { cwds, carry: cut >= 0 && OSC7.startsWith(tail.slice(cut)) ? tail.slice(cut) : '' }
}

/** A path as one word for a POSIX shell: as it is when plain, else in single quotes. */
export const shellQuote = (p: string) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)
