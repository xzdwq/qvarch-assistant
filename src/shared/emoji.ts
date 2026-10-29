/**
 * An emoji as Unicode composes it (one pattern for the whole app — a mark of a note, a reaction, the editor's emoji):
 * a pictograph with its variation, skin tone and subdivision tags (🏴 of England), pictographs joined by ZWJ (👩‍💻),
 * a country flag — a pair of regional letters (🇶🇦), a keycap (1️⃣).
 */
const PICTOGRAPH = String.raw`\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:[\u{E0020}-\u{E007E}]+\u{E007F})?`
const ONE = String.raw`(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|${PICTOGRAPH}(?:‍${PICTOGRAPH})*)`

/** The longest emoji kept (code units: a family or a flag of a subdivision is long). */
export const EMOJI_MAX = 32
/** Each emoji of a text (global: reset lastIndex before an exec loop). */
export const EMOJI_IN = new RegExp(ONE, 'gu')
/** A text of one to three emoji alone (spaces around and between). */
export const EMOJI_ONLY = new RegExp(String.raw`^\s*(?:${ONE}\s*){1,3}$`, 'u')
/** Whether a text may hold an emoji at all (a quick look before the exact one). */
export const mayHaveEmoji = (text: string): boolean => /[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u.test(text)
/** Exactly one emoji, nothing else. */
export const isEmoji = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= EMOJI_MAX && new RegExp(`^${ONE}$`, 'u').test(x)
