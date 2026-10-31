import type { HarnessGuide } from './guides'

type Builtin = Pick<HarnessGuide, 'id' | 'title' | 'summary' | 'body'>

/**
 * What the app's instructions do to the kept ones at the start: a new one (or a new installation) — added; one the
 * person has not edited — its new text; one the person edited — left as it is; one the person deleted — not back.
 */
export function guideSeed(kept: readonly HarnessGuide[], builtins: readonly Builtin[], dismissed: ReadonlySet<string>): HarnessGuide[] {
  const out: HarnessGuide[] = []
  for (const b of builtins) {
    if (dismissed.has(b.id)) continue
    const k = kept.find((g) => g.id === b.id)
    if (!k) out.push({ ...b, enabled: true, origin: 'builtin', edited: false })
    else if (k.origin === 'builtin' && !k.edited && (k.title !== b.title || k.summary !== b.summary || k.body !== b.body)) out.push({ ...k, title: b.title, summary: b.summary, body: b.body })
  }
  return out
}
