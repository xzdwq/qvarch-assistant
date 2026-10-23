<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CHART_TYPES, chartMd, chartTypeOf, num, parseChart, seriesColor, type ChartModel } from './model'
import Icon from '@renderer/components/Icon.vue'

/**
 * A chart of the notebook: columns, bars, lines, areas or a pie from a small table (the first column — the
 * labels, the others — the series). «Данные» opens the table to edit; the file keeps a ```chart fence.
 */
const props = defineProps<{ src: string; autofocus?: boolean }>()
const emit = defineEmits<{ change: [src: string] }>()
const m = ref<ChartModel>(parseChart(props.src))
let mine = props.src
watch(
  () => props.src,
  (s) => {
    if (s === mine) return
    mine = s
    m.value = parseChart(s)
  },
)
let timer: ReturnType<typeof setTimeout> | undefined
function save(now = false): void {
  clearTimeout(timer)
  const go = () => {
    const md = chartMd(m.value)
    if (md === mine) return
    mine = md
    emit('change', md)
  }
  if (now) go()
  else timer = setTimeout(go, 300)
}
const editing = ref(!!props.autofocus)
const series = computed(() =>
  m.value.head.slice(1).map((name, i) => ({ name: name || `Ряд ${i + 1}`, color: seriesColor(i), values: m.value.rows.map((r) => num(r[i + 1])) })),
)
const labels = computed(() => m.value.rows.map((r) => r[0] ?? ''))
// ---------- geometry ----------
const W = 640
const H = 280
const PAD = { l: 48, r: 16, t: 14, b: 34 }
const chartType = computed(() => chartTypeOf(m.value.type))
const stackedOn = computed(() => m.value.stacked && chartType.value.stackable)
const range = computed(() => {
  let lo = 0
  let hi = 0
  if (stackedOn.value)
    labels.value.forEach((_, i) => {
      let pos = 0
      let neg = 0
      for (const s of series.value) {
        const v = s.values[i]
        if (!Number.isFinite(v)) continue
        if (v >= 0) pos += v
        else neg += v
      }
      hi = Math.max(hi, pos)
      lo = Math.min(lo, neg)
    })
  else for (const s of series.value) for (const v of s.values) if (Number.isFinite(v)) ((hi = Math.max(hi, v)), (lo = Math.min(lo, v)))
  if (hi === lo) hi = lo + 1
  // round to a nice step
  const raw = (hi - lo) / 5
  const p = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? raw
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step }
})
const ticks = computed(() => {
  const out: number[] = []
  for (let v = range.value.lo; v <= range.value.hi + 1e-9; v += range.value.step) out.push(Math.round(v * 1e6) / 1e6)
  return out
})
const fmt = (v: number) => (Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${+(v / 1e3).toFixed(1)}k` : String(+v.toFixed(2)))
const vy = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - range.value.lo) / (range.value.hi - range.value.lo))
const vx = (v: number) => PAD.l + 90 + (W - PAD.l - 90 - PAD.r) * ((v - range.value.lo) / (range.value.hi - range.value.lo))
const n = computed(() => Math.max(1, labels.value.length))
const band = computed(() => (W - PAD.l - PAD.r) / n.value)
const bx = (i: number) => PAD.l + band.value * i
const bars = computed(() => {
  const out: Array<{ x: number; y: number; w: number; h: number; color: string; tip: string }> = []
  const k = series.value.length || 1
  labels.value.forEach((lab, i) => {
    let pos = 0
    let neg = 0
    series.value.forEach((s, si) => {
      const v = s.values[i]
      if (!Number.isFinite(v)) return
      const tip = `${lab} · ${s.name}: ${v}`
      if (m.value.type === 'hbar') {
        const bh = (H - PAD.t - PAD.b) / n.value
        const y0 = PAD.t + bh * i + bh * 0.15
        const inner = bh * 0.7
        if (stackedOn.value) {
          const a = v >= 0 ? pos : neg + v
          if (v >= 0) pos += v
          else neg += v
          out.push({ x: vx(a), y: y0, w: Math.abs(vx(a + Math.abs(v)) - vx(a)), h: inner, color: s.color, tip })
        } else out.push({ x: vx(Math.min(0, v)), y: y0 + (inner / k) * si, w: Math.abs(vx(v) - vx(0)), h: inner / k - 1, color: s.color, tip })
        return
      }
      const x0 = bx(i) + band.value * 0.15
      const inner = band.value * 0.7
      if (stackedOn.value) {
        const a = v >= 0 ? pos : neg
        if (v >= 0) pos += v
        else neg += v
        const top = v >= 0 ? vy(a + v) : vy(a)
        out.push({ x: x0, y: top, w: inner, h: Math.abs(vy(a) - vy(a + v)), color: s.color, tip })
      } else out.push({ x: x0 + (inner / k) * si, y: vy(Math.max(0, v)), w: inner / k - 1, h: Math.abs(vy(v) - vy(0)), color: s.color, tip })
    })
  })
  return out
})
const cx = (i: number) => bx(i) + band.value / 2
const lines = computed(() => {
  let base = labels.value.map(() => 0)
  return series.value.map((s) => {
    const pts = s.values.map((v, i) => {
      const y = stackedOn.value ? base[i] + (Number.isFinite(v) ? v : 0) : v
      return { x: cx(i), y: Number.isFinite(y) ? vy(y) : NaN, v, i }
    })
    const ok = pts.filter((p) => Number.isFinite(p.y))
    const d = ok.map((p, j) => `${j ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    const prev = base
    const area =
      m.value.type === 'area' && ok.length
        ? `${d} ${stackedOn.value ? [...ok].reverse().map((p) => `L${p.x.toFixed(1)},${vy(prev[p.i]).toFixed(1)}`).join(' ') : `L${ok[ok.length - 1].x.toFixed(1)},${vy(Math.max(range.value.lo, 0)).toFixed(1)} L${ok[0].x.toFixed(1)},${vy(Math.max(range.value.lo, 0)).toFixed(1)}`} Z`
        : ''
    if (stackedOn.value) base = base.map((b, i) => b + (Number.isFinite(s.values[i]) ? s.values[i] : 0))
    return { ...s, d, area, pts: ok }
  })
})
const pie = computed(() => {
  const s = series.value[0]
  if (!s) return []
  const vals = s.values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0))
  const total = vals.reduce((a, b) => a + b, 0) || 1
  let a0 = -Math.PI / 2
  const R = 110
  const C = { x: 200, y: H / 2 }
  return vals.map((v, i) => {
    const a1 = a0 + (v / total) * Math.PI * 2
    const large = a1 - a0 > Math.PI ? 1 : 0
    const p = (a: number, r: number) => `${(C.x + r * Math.cos(a)).toFixed(1)},${(C.y + r * Math.sin(a)).toFixed(1)}`
    const d = v >= total ? `M${C.x - R},${C.y} a${R},${R} 0 1,0 ${R * 2},0 a${R},${R} 0 1,0 ${-R * 2},0 M${C.x - R * 0.55},${C.y} a${R * 0.55},${R * 0.55} 0 1,1 ${R * 1.1},0 a${R * 0.55},${R * 0.55} 0 1,1 ${-R * 1.1},0` : `M${p(a0, R)} A${R},${R} 0 ${large},1 ${p(a1, R)} L${p(a1, R * 0.55)} A${R * 0.55},${R * 0.55} 0 ${large},0 ${p(a0, R * 0.55)} Z`
    const out = { d, color: seriesColor(i), label: labels.value[i], v, pct: Math.round((v / total) * 1000) / 10 }
    a0 = a1
    return out
  })
})
const showEvery = computed(() => Math.max(1, Math.ceil(labels.value.length / 12)))
// ---------- the data editor ----------
function setCell(r: number, c: number, v: string): void {
  if (r === -1) m.value.head[c] = v
  else m.value.rows[r][c] = v
  save()
}
function addRow(): void {
  m.value.rows.push(Array(m.value.head.length).fill(''))
  save(true)
}
function addSeries(): void {
  m.value.head.push(`Ряд ${m.value.head.length}`)
  for (const r of m.value.rows) r.push('')
  save(true)
}
function delRow(i: number): void {
  m.value.rows.splice(i, 1)
  save(true)
}
function delCol(c: number): void {
  if (m.value.head.length <= 2) return
  m.value.head.splice(c, 1)
  for (const r of m.value.rows) r.splice(c, 1)
  save(true)
}
const hover = ref('')
</script>

<template>
  <div class="bc tw:flex tw:flex-col tw:gap-6 tw:py-10 tw:px-12 tw:border tw:border-border tw:rounded-[8px] tw:bg-panel">
    <div class="bc-h tw:flex tw:items-center tw:gap-10 tw:flex-wrap">
      <input v-model="m.title" class="bc-t tw:flex-1 tw:min-w-140 tw:h-28 tw:py-0 tw:px-4 tw:border-0 tw:bg-transparent tw:text-text-hi tw:[font-style:inherit] tw:[font-variant:inherit] tw:font-stretch-[inherit] tw:[font-size:inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:font-semibold tw:outline-none" placeholder="Название графика" spellcheck="false" @input="save()" @blur="save(true)" />
      <span class="bc-types tw:inline-flex tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden">
        <button class="tw:h-24 tw:py-0 tw:px-8 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text-2 tw:text-[11.5px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" v-for="t in CHART_TYPES" :key="t.id" :class="{ on: m.type === t.id }" @mousedown.prevent @click="((m.type = t.id), save(true))">{{ t.title }}</button>
      </span>
      <label v-if="chartType.stackable" class="bc-chk tw:inline-flex tw:items-center tw:gap-5 tw:text-text-2 tw:text-[12px]"><input v-model="m.stacked" type="checkbox" @change="save(true)" />Накоплением</label>
      <button class="bc-ed tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-9 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:[&.on]:border-accent/60 tw:[&.on]:text-accent-fg tw:hover:enabled:bg-hover tw:hover:enabled:not-[&.on]:border-border-3" :class="{ on: editing }" @mousedown.prevent @click="editing = !editing"><Icon name="table" :size="13" />Данные</button>
    </div>
    <svg :viewBox="`0 0 ${W} ${H}`" class="bc-svg tw:w-full tw:max-h-320" preserveAspectRatio="xMidYMid meet">
      <template v-if="chartType.shape === 'pie'">
        <path v-for="(s, i) in pie" :key="i" :d="s.d" :style="{ fill: s.color }" stroke="var(--bg)" stroke-width="2" @mouseenter="hover = `${s.label}: ${s.v} (${s.pct}%)`" @mouseleave="hover = ''" />
        <g v-for="(s, i) in pie" :key="'l' + i" :transform="`translate(360, ${30 + i * 24})`">
          <rect width="12" height="12" rx="2" :style="{ fill: s.color }" />
          <text x="20" y="10" class="lab tw:[fill:var(--text-2)] tw:font-ui tw:text-[12px]">{{ s.label }} — {{ s.pct }}%</text>
        </g>
      </template>
      <template v-else>
        <g v-if="m.type === 'hbar'">
          <g v-for="v in ticks" :key="v">
            <line :x1="vx(v)" :x2="vx(v)" :y1="PAD.t" :y2="H - PAD.b" class="gridline tw:[stroke:var(--border)] tw:stroke-1" />
            <text :x="vx(v)" :y="H - PAD.b + 16" text-anchor="middle" class="ax tw:[fill:var(--muted)] tw:font-data tw:text-[11px]">{{ fmt(v) }}</text>
          </g>
          <text v-for="(l, i) in labels" :key="i" :x="PAD.l + 84" :y="PAD.t + ((H - PAD.t - PAD.b) / n) * (i + 0.5) + 4" text-anchor="end" class="ax tw:[fill:var(--muted)] tw:font-data tw:text-[11px]">{{ l.length > 14 ? l.slice(0, 13) + '…' : l }}</text>
        </g>
        <g v-else>
          <g v-for="v in ticks" :key="v">
            <line :x1="PAD.l" :x2="W - PAD.r" :y1="vy(v)" :y2="vy(v)" class="gridline tw:[stroke:var(--border)] tw:stroke-1 tw:[&.zero]:[stroke:var(--border-3)]" :class="{ zero: v === 0 }" />
            <text :x="PAD.l - 6" :y="vy(v) + 4" text-anchor="end" class="ax tw:[fill:var(--muted)] tw:font-data tw:text-[11px]">{{ fmt(v) }}</text>
          </g>
          <template v-for="(l, i) in labels" :key="i">
            <text v-if="i % showEvery === 0" :x="cx(i)" :y="H - PAD.b + 16" text-anchor="middle" class="ax tw:[fill:var(--muted)] tw:font-data tw:text-[11px]">{{ l.length > 10 ? l.slice(0, 9) + '…' : l }}</text>
          </template>
        </g>
        <template v-if="chartType.shape === 'bars'">
          <rect v-for="(b, i) in bars" :key="i" :x="b.x" :y="b.y" :width="Math.max(0, b.w)" :height="Math.max(0, b.h)" :style="{ fill: b.color }" rx="2" @mouseenter="hover = b.tip" @mouseleave="hover = ''" />
        </template>
        <template v-else>
          <g v-for="(s, si) in lines" :key="si">
            <path v-if="s.area" :d="s.area" :style="{ fill: s.color }" fill-opacity="0.22" />
            <path :d="s.d" fill="none" :style="{ stroke: s.color }" stroke-width="2.2" stroke-linejoin="round" />
            <circle v-for="p in s.pts" :key="p.i" :cx="p.x" :cy="p.y" r="3.5" :style="{ fill: s.color }" @mouseenter="hover = `${labels[p.i]} · ${s.name}: ${p.v}`" @mouseleave="hover = ''" />
          </g>
        </template>
      </template>
    </svg>
    <div class="bc-leg tw:flex tw:items-center tw:gap-14 tw:min-h-18 tw:text-text-2 tw:text-[12px]">
      <template v-if="chartType.shape !== 'pie'">
        <span v-for="s in series" :key="s.name"><i class="tw:inline-block tw:w-10 tw:h-10 tw:mr-6 tw:rounded-[2px] tw:[vertical-align:-1px]" :style="{ background: s.color }"></i>{{ s.name }}</span>
      </template>
      <span class="grow tw:flex-1"></span>
      <span v-if="hover" class="bc-tip tw:text-text-hi tw:font-data">{{ hover }}</span>
    </div>
    <div v-if="editing" class="bc-data tw:flex tw:flex-col tw:items-start tw:gap-6 tw:pt-8 tw:border-t tw:border-t-border tw:overflow-x-auto">
      <table class="tw:border-collapse tw:text-[12.5px]">
        <thead>
          <tr>
            <th class="tw:group/g29 tw:relative tw:p-0 tw:border tw:border-border" v-for="(h, c) in m.head" :key="c">
              <input class="tw:w-110 tw:h-28 tw:py-0 tw:px-8 tw:border-0 tw:rounded-none tw:bg-transparent tw:[font-style:inherit] tw:[font-variant:inherit] tw:font-stretch-[inherit] tw:[font-size:inherit] tw:[line-height:inherit] tw:font-[inherit] tw:outline-none tw:[&&]:font-semibold tw:text-text-hi tw:focus:[box-shadow:inset_0_0_0_2px_rgb(var(--accent-rgb)/0.7)]" :value="h" spellcheck="false" @input="setCell(-1, c, ($event.target as HTMLInputElement).value)" @blur="save(true)" />
              <button v-if="c > 0 && m.head.length > 2" class="x tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:ml-4 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:absolute tw:top-3 tw:right-2 tw:opacity-0 tw:group-hover/g29:opacity-100 tw:hover:bg-hover tw:hover:text-text" title="Убрать ряд" @mousedown.prevent @click="delCol(c)"><Icon name="x" :size="11" /></button>
            </th>
            <th class="act tw:relative tw:p-0 tw:border-0"><button class="tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:ml-4 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Добавить ряд (столбец значений)" @mousedown.prevent @click="addSeries"><Icon name="plus" :size="12" /></button></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, ri) in m.rows" :key="ri">
            <td class="tw:relative tw:p-0 tw:border tw:border-border" v-for="(c, ci) in r" :key="ci"><input class="tw:w-110 tw:h-28 tw:py-0 tw:px-8 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[font-size:inherit] tw:[line-height:inherit] tw:outline-none tw:focus:[box-shadow:inset_0_0_0_2px_rgb(var(--accent-rgb)/0.7)] tw:[&.numc]:font-data tw:[&.numc]:text-right tw:[&.bad]:text-down-fg" :value="c" spellcheck="false" :class="{ numc: ci > 0, bad: ci > 0 && c.trim() !== '' && !Number.isFinite(num(c)) }" @input="setCell(ri, ci, ($event.target as HTMLInputElement).value)" @blur="save(true)" /></td>
            <td class="act tw:relative tw:p-0 tw:border-0"><button class="tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:ml-4 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Удалить строку" @mousedown.prevent @click="delRow(ri)"><Icon name="x" :size="11" /></button></td>
          </tr>
        </tbody>
      </table>
      <button class="bc-add tw:hover:bg-hover tw:hover:text-text tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-9 tw:border tw:border-dashed tw:border-border-2 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:border-border-3" @mousedown.prevent @click="addRow"><Icon name="plus" :size="12" />Строка</button>
    </div>
  </div>
</template>
