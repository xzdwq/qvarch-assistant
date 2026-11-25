/**
 * The letter of a shortcut by the key's place, whatever the keyboard layout: Ctrl+T is Ctrl+T in a Russian layout too
 * (there the key gives «е»). A key with no letter place (digits, «-», F5…) — as it is named, lower-cased.
 */
export function shortcutLetter(key: string, code?: string): string {
  const m = /^Key([A-Z])$/.exec(code ?? '')
  return m ? m[1].toLowerCase() : key.toLowerCase()
}
