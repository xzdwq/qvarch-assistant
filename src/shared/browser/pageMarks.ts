/**
 * The colours the app draws with on a site's own page — none of the app's CSS is there: the recorder's frame and
 * badge, the outlines of layout flaws and their labels.
 */
export const PAGE_MARK = {
  /** The frame's line, the label's background. */
  line: '#ef4444',
  /** Inside a flaw's outline. */
  fill: 'rgba(239,68,68,.12)',
  /** Inside the recorder's frame (lighter: the element must stay readable). */
  faintFill: 'rgba(239,68,68,.08)',
  /** Text on the line's colour. */
  onLine: '#fff',
  /** Under a badge. */
  shadow: 'rgba(0,0,0,.3)',
} as const
