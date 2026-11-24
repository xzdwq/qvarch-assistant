/**
 * The link under the pointer, shown in the page's bottom corner (as browsers do): its text and where the bubble
 * goes — the bottom left, or the bottom right while the pointer is near the left one.
 */

/** The bubble's size bounds, px: its widest share of the page, its narrowest. */
export const LINK_STATUS_SIZE = { maxShare: 0.6, minWidth: 120 } as const
/** The bubble moves aside when the pointer comes this close to it, px. */
const NEAR = 24

export type StatusBox = { x: number; y: number; width: number; height: number }

/** A link's address as shown: readable (its escaped letters decoded where they are text), else as it is. */
export function linkStatusText(url: string): string {
  try {
    return decodeURI(url)
  } catch {
    return url
  }
}

/** The widest the bubble may be in a page this wide. */
export const linkStatusMaxWidth = (pageWidth: number): number => Math.max(Math.min(LINK_STATUS_SIZE.minWidth, pageWidth), Math.floor(pageWidth * LINK_STATUS_SIZE.maxShare))

/**
 * The bubble's place in a page (all in the window's px): its bottom-left corner; the pointer over or near that place —
 * the bottom-right one (the bubble never sits under the pointer). Kept inside the page.
 */
export function linkStatusPlace(page: StatusBox, size: { width: number; height: number }, pointer?: { x: number; y: number }): StatusBox {
  const width = Math.max(1, Math.min(size.width, page.width))
  const height = Math.max(1, Math.min(size.height, page.height))
  const y = page.y + page.height - height
  const left = { x: page.x, y, width, height }
  const near = (b: StatusBox) => !!pointer && pointer.x >= b.x - NEAR && pointer.x <= b.x + b.width + NEAR && pointer.y >= b.y - NEAR && pointer.y <= b.y + b.height + NEAR
  return near(left) ? { ...left, x: page.x + page.width - width } : left
}
