import type { ViewNodeKind } from '@shared/notebook/graph'
import { iconSvg } from '@renderer/components/Icon.vue'
import { cssColor } from '@renderer/lib/cssColor'

/**
 * How the notebook's graph looks: each kind of node — its colour (the theme's) and its icon (shown with its label);
 * a node's size by its links — growing slower and slower, never past a bound; the icons as pictures for the canvas.
 */
export const NODE_LOOK: Record<ViewNodeKind, { title: string; color: `--${string}`; icon: string }> = {
  note: { title: 'заметка', color: '--graph-note', icon: 'note' },
  ghost: { title: 'нет заметки', color: '--graph-ghost', icon: 'note' },
  folder: { title: 'папка', color: '--graph-folder', icon: 'folder' },
  tag: { title: 'тег', color: '--graph-tag', icon: 'tag' },
  table: { title: 'таблица', color: '--graph-table', icon: 'database' },
  endpoint: { title: 'запрос', color: '--graph-endpoint', icon: 'api' },
  host: { title: 'сайт', color: '--graph-host', icon: 'globe' },
  jira: { title: 'задача', color: '--graph-jira', icon: 'jira' },
  event: { title: 'событие', color: '--graph-event', icon: 'calendar' },
}

/** A node's radius: the base, growing with the root of its links, at most `MAX_GROW` times the base. */
const BASE_R = 4
const MAX_GROW = 3.2
export const radiusOf = (degree: number) => BASE_R * Math.min(MAX_GROW, 1 + Math.sqrt(degree) * 0.45)

/** A colour mark as the canvas takes it (a mark may be a theme's variable). */
export const markColor = (c: string) => {
  const v = /^var\((--[\w-]+)\)$/.exec(c.trim())
  return v ? cssColor(v[1] as `--${string}`) : c
}

/** The icons drawn as pictures, by name and colour (made once each; ready — before the first frame). */
const pictures = new Map<string, HTMLImageElement>()
export function iconPicture(name: string, color: string): HTMLImageElement | undefined {
  const key = `${name}|${color}`
  return pictures.get(key)
}
export function loadIconPictures(colors: readonly string[]): Promise<void> {
  const names = [...new Set(Object.values(NODE_LOOK).map((l) => l.icon))]
  const loads: Array<Promise<void>> = []
  for (const name of names)
    for (const color of colors) {
      const key = `${name}|${color}`
      if (pictures.has(key)) continue
      const img = new Image()
      const svg = iconSvg(name, 24, 2).replace(/currentColor/g, color)
      loads.push(new Promise((ok) => ((img.onload = () => ok()), (img.onerror = () => ok()))))
      img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`
      pictures.set(key, img)
    }
  return Promise.all(loads).then(() => undefined)
}
