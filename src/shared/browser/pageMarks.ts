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

/** The link under the pointer, in the page's bottom corner (a view of its own over the page — no app CSS there). */
export const LINK_STATUS_MARK = {
  bg: '#161b22',
  text: '#c9d1d9',
  line: '#30363d',
} as const

/** The inspector's frame over the element under the pointer and its card (drawn by the page's preload). */
export const INSPECT_MARK = {
  /** The element's box: content, padding, margin (translucent, as DevTools paints them). */
  content: 'rgba(57,135,229,.28)',
  padding: 'rgba(12,163,12,.25)',
  margin: 'rgba(217,89,38,.22)',
  /** Its outline (the element hovered; pinned — the stronger one). */
  line: '#3987e5',
  pinned: '#ff6b00',
  /** An element shown from the log. */
  shown: '#ff6b00',
  shownFill: 'rgba(255,107,0,.18)',
  /** The card. */
  card: '#161b22',
  cardLine: '#30363d',
  text: '#c9d1d9',
  muted: '#8b949e',
  tag: '#ff7b72',
  id: '#ffa657',
  cls: '#79c0ff',
  good: '#3fb950',
  warn: '#d29922',
  bad: '#f85149',
  shadow: 'rgba(0,0,0,.45)',
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
