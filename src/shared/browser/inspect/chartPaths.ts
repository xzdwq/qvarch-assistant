/**
 * The inspector's small charts as SVG paths (one y axis each — never two scales in one chart): a line of values,
 * a stack of series (their areas one on another), the axis' top made round, the sample nearest to a pointer.
 */

/** A round top for an axis: the value's next 1 / 2 / 5 × 10ⁿ (at least `min`). */
export function niceMax(v: number, min = 1): number {
  const x = Math.max(v, min)
  const p = 10 ** Math.floor(Math.log10(x))
  return ([1, 2, 5, 10].map((k) => k * p).find((k) => k >= x) ?? 10 * p) as number
}
const fx = (i: number, n: number, w: number) => (n < 2 ? w : (i / (n - 1)) * w)
const fy = (v: number, max: number, h: number) => h - (Math.max(0, Math.min(v, max)) / max) * h
const num = (n: number) => Math.round(n * 10) / 10

/** A line through the values over the width (the newest at the right). */
export function linePath(values: number[], w: number, h: number, max: number): string {
  return values.map((v, i) => `${i ? 'L' : 'M'}${num(fx(i, values.length, w))},${num(fy(v, max, h))}`).join('')
}
/** The areas of series stacked one on another (the first at the bottom), each a closed path. */
export function stackPaths(series: number[][], w: number, h: number, max: number): string[] {
  const n = series[0]?.length ?? 0
  const base = new Array<number>(n).fill(0)
  return series.map((s) => {
    const low = [...base]
    for (let i = 0; i < n; i++) base[i] += s[i] ?? 0
    const top = base.map((v, i) => `${i ? 'L' : 'M'}${num(fx(i, n, w))},${num(fy(v, max, h))}`).join('')
    const back = low.map((v, i) => `L${num(fx(i, n, w))},${num(fy(v, max, h))}`).reverse().join('')
    return n ? `${top}${back}Z` : ''
  })
}
/** The sample under a pointer at x of the width. */
export const nearestIndex = (x: number, w: number, n: number): number => (n < 2 ? 0 : Math.max(0, Math.min(n - 1, Math.round((x / w) * (n - 1)))))
