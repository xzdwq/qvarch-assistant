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

/** The rulers over a page (dark bars along the top and the left, the guides pulled out of them). */
export const RULER_MARK = {
  /** The bars' background. */
  bar: 'rgba(22,27,34,.92)',
  /** The numbers on the bars. */
  text: '#adb7c6',
  tick: '#566173',
  /** The bars' edge. */
  line: '#30363d',
  corner: '#161b22',
  /** The pointer's place on the bars, the corner's ×. */
  mark: '#ff6b00',
  /** A vertical guide (pulled out of the left bar). */
  guideV: '#18e0ff',
  /** A horizontal guide (pulled out of the top bar). */
  guideH: '#ff4fd8',
  /** A guide's label text (on the guide's colour). */
  onGuide: '#0d1117',
} as const
