/** A scenario's pages by their addresses: where it starts, and which open tab is already there. */

/** An address as compared: its fragment, trailing slashes and letters' case aside. */
const plain = (url: string) => url.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()
/** The same page (a tab already at the address a scenario opens). */
export const sameAddress = (a: string, b: string) => plain(a) === plain(b)

/** Where a scenario starts: its first page.goto with a written http(s) address (none — it names no page itself). */
export function startAddressOf(code: string): string | undefined {
  const m = /page\.goto\(\s*['"`](https?:\/\/[^'"`$]+)['"`]/.exec(code)
  return m?.[1]
}
