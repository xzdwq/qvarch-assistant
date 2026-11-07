/**
 * Whether a shell block's script may run: one the person wrote runs; one changed by someone else (a shared folder,
 * the AI, a sync) waits for their approval. An approval belongs to the exact text of the block (its info line and
 * body) in its note — any change takes it away.
 */

/**
 * A block's own say: `auto` — the rule above; `always` — asked before every run; `never` — never asked (once approved,
 * until its script changes); `trust` — allowed for good, its script changed or not (the approval is the block's line's).
 */
export const SHELL_ASK = ['auto', 'always', 'never', 'trust'] as const
export type ShellAsk = (typeof SHELL_ASK)[number]
export const isShellAsk = (v: string): v is ShellAsk => (SHELL_ASK as readonly string[]).includes(v)

export const TRUST_VERDICTS = ['run', 'confirm'] as const
export type TrustVerdict = (typeof TRUST_VERDICTS)[number]

/** Words of an info line that change nothing of what runs and where: its id, shown height, name, batch / soft flags. */
const NOT_RUN = /^(id=|h=|name=|skip$|soft$)/

/**
 * The fingerprint of a block's script: its note, its info line (without the words that change nothing of what runs —
 * renaming it or leaving it out of the batch keeps its approval) and its body.
 */
export function shellFingerprint(notePath: string, infoLine: string, body: string, sha256: (s: string) => string): string {
  const words = infoLine.split(/\s+/).filter((w) => w && !NOT_RUN.test(w))
  // allowed for good: its body is not part of it (it may change); its line is — `ask=trust` written by someone else
  // is a new line, asked about once
  const trusted = words.includes('ask=trust')
  return sha256(`${notePath}\n${words.join(' ')}\n${trusted ? '' : body}`)
}

/** Run or ask: told to ask always — ask; approved — run; anything else — ask. */
export const trustVerdict = (ask: ShellAsk, approved: boolean): TrustVerdict => (ask !== 'always' && approved ? 'run' : 'confirm')
