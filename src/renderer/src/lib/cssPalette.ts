import { cssHex } from './cssColor'

/**
 * A palette defined in CSS as numbered variables `<prefix>-1`, `<prefix>-2`, … — its colours as `#rrggbb`, up to
 * the first one missing (for swatches whose pick is saved into the user's data).
 */
export function cssPalette(prefix: `--${string}`): string[] {
  const colors: string[] = []
  for (let n = 1; ; n++) {
    const color = cssHex(`${prefix}-${n}`)
    if (!color) return colors
    colors.push(color)
  }
}
