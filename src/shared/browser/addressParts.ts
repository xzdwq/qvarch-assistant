/** An address in parts for its colours: the scheme grey, the host bright, the path calm, the query in the accent. */
export type AddressPart = { t: string; c: 'u-scheme' | 'u-host' | 'u-path' | 'u-sep' | 'u-key' | 'u-val' | 'u-hash' }

/** The address line's text split into its coloured parts (the classes the line paints them by). */
export function addressParts(url: string): AddressPart[] {
  const m = url.match(/^([a-z][\w+.-]*:(?:\/\/)?)([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i)
  if (!m) return [{ t: url, c: 'u-path' }]
  const out: AddressPart[] = [
    { t: m[1], c: 'u-scheme' },
    { t: m[2], c: 'u-host' },
    { t: m[3], c: 'u-path' },
  ]
  if (m[4]) {
    // ? key = value & …
    for (const part of m[4].split(/(?=[?&])/)) {
      const [k, ...v] = part.slice(1).split('=')
      out.push({ t: part[0], c: 'u-sep' }, { t: k, c: 'u-key' })
      if (v.length) out.push({ t: '=', c: 'u-sep' }, { t: v.join('='), c: 'u-val' })
    }
  }
  if (m[5]) out.push({ t: m[5], c: 'u-hash' })
  return out
}
