import { shellQuote } from './remoteShell'

/**
 * Commands run on a server as root (`sudo`) or as oneself, by one fixed script and its arguments (`sh -c '…' sh a b`):
 * the values never become code. sudo's password goes to its stdin (`-S`) and nothing else does — a cached sign-in or
 * NOPASSWD leaves it unread, so file contents always travel through a temporary file. No password known yet — `-n`:
 * sudo says it needs one without counting a failed sign-in (a domain account may lock after a few).
 */

/** How a script runs: as the signed-in user, as root without a password (`-n`), as root with one on stdin (`-S`). */
export const RUN_AS = ['self', 'sudoNoPassword', 'sudoPassword'] as const
export type RunAs = (typeof RUN_AS)[number]

/** sudo's prompt, told apart in its stderr: shown — it asked for the password. */
export const SUDO_PROMPT = '[qa-sudo-password]'
/** The script's first word to stderr: there — sudo let it run. */
export const SUDO_RAN = 'QA_SUDO_RAN'
/** A save's script exits with this when the file changed on the server since it was read. */
export const EXIT_CHANGED = 3

/** The command line for a script with its arguments. */
export function scriptCommand(script: string, args: string[], as: RunAs): string {
  const tail = ['sh', '-c', shellQuote(script), 'sh', ...args.map(shellQuote)].join(' ')
  switch (as) {
    case 'self':
      return tail
    case 'sudoNoPassword':
      return `LC_ALL=C sudo -n -- ${tail}`
    case 'sudoPassword':
      return `LC_ALL=C sudo -S -p ${shellQuote(SUDO_PROMPT)} -- ${tail}`
  }
}

/** What a sudo run's stderr and exit say: it ran, it needs a password, the password did not fit, or sudo refused. */
export type SudoOutcome = { kind: 'ran' } | { kind: 'needsPassword' } | { kind: 'wrongPassword' } | { kind: 'refused'; message: string }
export function sudoOutcome(stderr: string): SudoOutcome {
  if (stderr.includes(SUDO_RAN)) return { kind: 'ran' }
  if (stderr.includes(SUDO_PROMPT)) return { kind: 'wrongPassword' }
  if (/password is required/i.test(stderr)) return { kind: 'needsPassword' }
  return { kind: 'refused', message: cleanStderr(stderr) || 'sudo не выполнил команду' }
}
/** stderr as shown to the person: our marks taken out, lines joined. */
export function cleanStderr(stderr: string): string {
  return stderr
    .split(SUDO_PROMPT)
    .join('')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && l !== SUDO_RAN)
    .join(' · ')
}

const RAN = `printf '%s\\n' ${SUDO_RAN} >&2`
/**
 * The marks before what a script tells in its output: a server's shell may print its own lines first (a login
 * script, .bashrc run for `ssh host cmd`) — the value is found by its mark, not by its place.
 */
export const READ_MARK = 'QA_READ='
export const MTIME_MARK = 'QA_MTIME='

/** Read: `$1` path, `$2` the largest size read. Prints `QA_READ=mtime:size\n`, then the contents (none when larger). */
export const READ_SCRIPT = `${RAN}
s=$(stat -c %s -- "$1") || exit 2
m=$(stat -c %Y -- "$1") || exit 2
printf '${READ_MARK}%s:%s\\n' "$m" "$s"
[ "$s" -le "$2" ] || exit 0
exec cat -- "$1"`

/**
 * Save: `$1` the temporary file with the text, `$2` the file, `$3` its time when read ('' — not checked). Written over
 * in place (`cat >`): its owner and rights stay. Prints the new time.
 */
export const WRITE_SCRIPT = `${RAN}
if [ -n "$3" ] && [ "$(stat -c %Y -- "$2" 2>/dev/null)" != "$3" ]; then exit ${EXIT_CHANGED}; fi
cat -- "$1" > "$2" || exit 4
printf '${MTIME_MARK}%s\\n' "$(stat -c %Y -- "$2")"`

/** Backup: `$1` the file, `$2` the copy — with its owner, rights and times (`cp -p`). */
export const BACKUP_SCRIPT = `${RAN}
cp -p -- "$1" "$2"`

/**
 * Rights and owner: `$1` path, `$2` mode ('' — kept), `$3` owner, `$4` group ('' — kept), `$5` 1 — everything inside
 * too. chown first: it clears setuid / setgid, chmod then sets the mode asked for.
 */
export const ACCESS_SCRIPT = `${RAN}
p=$1; m=$2; o=$3; g=$4; r=; [ "$5" = 1 ] && r=-R
if [ -n "$o" ]; then chown $r -- "$o\${g:+:$g}" "$p" || exit 1
elif [ -n "$g" ]; then chgrp $r -- "$g" "$p" || exit 1; fi
if [ -n "$m" ]; then chmod $r -- "$m" "$p" || exit 1; fi
exit 0`

/** Where `mark` starts in bytes (-1 — not there). */
function indexOfBytes(out: Uint8Array, mark: string): number {
  const m = new TextEncoder().encode(mark)
  for (let i = out.indexOf(m[0]); i >= 0 && i <= out.length - m.length; i = out.indexOf(m[0], i + 1)) {
    let k = 1
    while (k < m.length && out[i + k] === m[k]) k++
    if (k === m.length) return i
  }
  return -1
}

/** The read script's output → the file's time, size and contents; lines before its mark skipped (undefined — no mark). */
export function parseReadOutput(out: Uint8Array): { mtime: number; size: number; body: Uint8Array } | undefined {
  const at = indexOfBytes(out, READ_MARK)
  if (at < 0) return undefined
  const nl = out.indexOf(10, at)
  if (nl < 0) return undefined
  const m = new TextDecoder().decode(out.subarray(at + READ_MARK.length, nl)).match(/^(\d+):(\d+)\r?$/)
  if (!m) return undefined
  return { mtime: Number(m[1]), size: Number(m[2]), body: out.subarray(nl + 1) }
}

/** The save script's output → the file's new time (undefined — no mark). */
export function parseMtimeOutput(out: string): number | undefined {
  const m = out.match(new RegExp(`${MTIME_MARK}(\\d+)`))
  return m ? Number(m[1]) : undefined
}
