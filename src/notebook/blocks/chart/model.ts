import { fenceBodyLines } from '../../domain/fence'

/** The chart component's model: ```chart with `type:`, `title:`, `stacked:` and a table of data (| ; tab or ,). */
/** How a chart draws its series: rectangles, paths through points, or one ring of slices. */
export type ChartShape = 'bars' | 'lines' | 'pie'
/** The chart types: their names, how they are drawn and whether series may be stacked. */
export const CHART_TYPES = [
  { id: 'bar', title: 'Столбцы', shape: 'bars', stackable: true },
  { id: 'hbar', title: 'Полосы', shape: 'bars', stackable: true },
  { id: 'line', title: 'Линии', shape: 'lines', stackable: false },
  { id: 'area', title: 'Области', shape: 'lines', stackable: true },
  { id: 'pie', title: 'Круговая', shape: 'pie', stackable: false },
] as const satisfies ReadonlyArray<{ id: string; title: string; shape: ChartShape; stackable: boolean }>
export type ChartType = (typeof CHART_TYPES)[number]['id']
const isChartType = (s: string): s is ChartType => CHART_TYPES.some((t) => t.id === s)
/** A chart type's entry. */
export const chartTypeOf = (type: ChartType) => CHART_TYPES.find((t) => t.id === type) ?? CHART_TYPES[0]
/** The series' colours, in turn (styles/colors/notebook.css). */
export const SERIES_COLORS = Array.from({ length: 8 }, (_, i) => `var(--chart-series-${i + 1})`)
export const seriesColor = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length]
export interface ChartModel {
  type: ChartType
  title: string
  stacked: boolean
  /** The first column — the labels; the others — the series. */
  head: string[]
  rows: string[][]
}
/** The settings lines before the data (`key: value`), each written into the model. */
const CHART_SETTINGS = {
  type: (m: ChartModel, v: string) => {
    if (isChartType(v)) m.type = v
  },
  title: (m: ChartModel, v: string) => {
    m.title = v
  },
  stacked: (m: ChartModel, v: string) => {
    m.stacked = /^(true|yes|да|1)$/i.test(v)
  },
} satisfies Record<string, (m: ChartModel, value: string) => void>
type ChartSetting = keyof typeof CHART_SETTINGS
const SETTING_LINE = new RegExp(`^\\s*(${Object.keys(CHART_SETTINGS).join('|')})\\s*:\\s*(.*)$`, 'i')
/** The data's cell separators, by preference; a comma when none of them is there. */
const SEPARATORS = ['|', ';', '\t'] as const

/** A chart's text → its model (unknown settings are data). */
export function parseChart(src: string): ChartModel {
  const m: ChartModel = { type: 'bar', title: '', stacked: false, head: [], rows: [] }
  const data: string[] = []
  for (const l of fenceBodyLines(src)) {
    const kv = SETTING_LINE.exec(l)
    if (kv && !data.length) CHART_SETTINGS[kv[1].toLowerCase() as ChartSetting](m, kv[2].trim())
    else if (l.trim()) data.push(l)
  }
  const sep = SEPARATORS.find((s) => data.some((l) => l.includes(s))) ?? ','
  const cells = data.map((l) => l.split(sep).map((c) => c.trim()))
  m.head = cells[0] ?? ['Подпись', 'Значение']
  const n = m.head.length
  m.rows = cells.slice(1).map((r) => [...r, ...Array(Math.max(0, n - r.length)).fill('')].slice(0, n))
  return m
}
/** A chart's model → its text. */
export function chartMd(m: ChartModel): string {
  const lines = ['```chart', `type: ${m.type}`]
  if (m.title) lines.push(`title: ${m.title}`)
  if (m.stacked) lines.push('stacked: true')
  for (const r of [m.head, ...m.rows]) lines.push(r.map((c) => c.replace(/\|/g, '/')).join(' | '))
  lines.push('```')
  return lines.join('\n')
}
/** A cell as a number («1 234,5» too); NaN when it is not one. */
export const num = (s: string) => Number(String(s).replace(/\s/g, '').replace(',', '.'))
/** A new chart's example data. */
export const NEW_CHART: ChartModel = { type: 'bar', title: 'Новый график', stacked: false, head: ['Месяц', 'План', 'Факт'], rows: [['Янв', '10', '12'], ['Фев', '14', '11'], ['Мар', '18', '20'], ['Апр', '20', '23']] }
