<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { activeArea, comboOf, isModifiersOnly, isQuarterTurn, monitorsBounds, pressureCurve, TABLET_BUTTONS, TABLET_MM, TABLET_ROTATIONS, type TabletButton, type TabletMonitor, type TabletPrefs } from '@shared/tablet'
import Icon from '../components/Icon.vue'
import { cssColor } from '../lib/cssColor'
import { useTablet, useTabletCanvas, useTabletLive } from '../lib/tablet'
import { useInk } from '../lib/ink'

/**
 * Планшет: Qvarch reads the pen tablet itself and drives the mouse — which screen (or only the Qvarch window),
 * the tablet's area and turn, the click pressure, the pressure curve for Qvarch's drawing, the side buttons;
 * a pad to try it all. Other apps get the mouse (no pressure): Windows here takes no synthetic pen.
 */
/** embedded — inside the settings (their scroll, no own full-height layout). */
defineProps<{ embedded?: boolean }>()
const { state, sample, set, keysMask, auxRaw } = useTablet()

// ---------- the express keys: a combination each, recorded by pressing it ----------
const KEY_HINTS = ['Кисть', 'Ластик', 'Alt', 'Пробел', 'Отмена', 'Крупнее', 'Мельче', 'Панель']
const recording = ref<number>()
const recorded = ref('')
function startRecord(i: number): void {
  recording.value = i
  recorded.value = ''
}
function onRecordKey(e: KeyboardEvent, i: number): void {
  e.preventDefault()
  e.stopPropagation()
  const plain = !e.ctrlKey && !e.altKey && !e.shiftKey
  const action = plain ? RECORD_KEYS[e.code] : undefined
  if (action) return action(i)
  const c = comboOf(e)
  recorded.value = c
  // a real key (not only modifiers) ends the recording
  if (c && !isModifiersOnly(c)) saveKey(i, c)
}
/** Plain keys that do not record: Esc cancels, Delete / Backspace clear the key. */
const RECORD_KEYS: Partial<Record<string, (i: number) => void>> = {
  Escape: () => (recording.value = undefined),
  Delete: (i) => saveKey(i, ''),
  Backspace: (i) => saveKey(i, ''),
}
/** Only modifiers held and let go ("Alt", "Ctrl+Shift") — that is the combination. */
function onRecordUp(i: number): void {
  if (recording.value === i && recorded.value) saveKey(i, recorded.value)
}
function saveKey(i: number, combo: string): void {
  recording.value = undefined
  const keys = [...(prefs.value?.keys ?? [])]
  keys[i] = combo
  void set({ keys })
}
useTabletLive()

const prefs = computed(() => state.value?.prefs)
const status = computed(() => state.value?.status ?? { state: 'off' as const })
const monitors = computed(() => state.value?.monitors ?? [])
/** Turned off after running: the system pen is back only after re-plugging. */
const replug = ref(false)
async function toggle(): Promise<void> {
  const on = !prefs.value?.enabled
  if (!on && status.value.state === 'connected') replug.value = true
  if (on) replug.value = false
  await set({ enabled: on })
}

// ---------- where ----------
const mapBox = computed(() => monitorsBounds(monitors.value))
function monStyle(m: TabletMonitor): Record<string, string> {
  const b = mapBox.value
  return { left: `${((m.x - b.x) / b.w) * 100}%`, top: `${((m.y - b.y) / b.h) * 100}%`, width: `${(m.w / b.w) * 100}%`, height: `${(m.h / b.h) * 100}%` }
}
const primaryName = computed(() => monitors.value.find((m) => m.primary)?.name ?? '')
const isMon = (m: TabletMonitor) => prefs.value?.target.kind === 'monitor' && (prefs.value.target.name || primaryName.value) === m.name
const monLabel = (m: TabletMonitor) => m.name.replace(/^\\\\\.\\DISPLAY/i, '')
/** The target's size in physical pixels — the tablet area's proportions. */
const targetSize = computed(() => {
  const t = prefs.value?.target
  if (!t) return { w: 16, h: 9 }
  const windowSize = () => ({ w: window.innerWidth * devicePixelRatio, h: window.innerHeight * devicePixelRatio })
  switch (t.kind) {
    case 'all':
      return mapBox.value
    case 'canvas':
      return state.value?.canvas ?? windowSize()
    case 'window':
      return windowSize()
    case 'monitor': {
      const name = t.name || primaryName.value
      return monitors.value.find((m) => m.name === name) ?? { w: 16, h: 9 }
    }
    default: {
      const never: never = t
      return never
    }
  }
})

// ---------- the tablet area ----------
const turned = computed(() => isQuarterTurn(prefs.value?.rotation ?? 0))
const tabAspect = computed(() => (turned.value ? TABLET_MM.h / TABLET_MM.w : TABLET_MM.w / TABLET_MM.h))
const area = computed(() => activeArea(prefs.value?.rotation ?? 0, !!prefs.value?.keepAspect, targetSize.value.w, targetSize.value.h))
const areaStyle = computed(() => {
  const [x0, y0, x1, y1] = area.value
  return { left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }
})
const penDot = computed(() => (sample.value?.in ? { left: `${sample.value.x * 100}%`, top: `${sample.value.y * 100}%` } : undefined))
const ROTS = TABLET_ROTATIONS

// ---------- the pen (sliders commit on release; the preview follows the drag) ----------
const draft = ref<Partial<TabletPrefs>>({})
watch(prefs, () => (draft.value = {}))
const val = <K extends keyof TabletPrefs>(k: K): TabletPrefs[K] | undefined => (draft.value[k] as TabletPrefs[K] | undefined) ?? prefs.value?.[k]
const pct = (k: 'click' | 'pmin' | 'pmax') => Math.round((val(k) ?? 0) * 100)
type SliderKey = 'click' | 'pmin' | 'pmax' | 'curve' | 'streamline' | 'smoothing' | 'thinning'
function drag(k: SliderKey, e: Event): void {
  draft.value = { ...draft.value, [k]: Number((e.target as HTMLInputElement).value) / 100 }
}
const pc = (k: 'streamline' | 'smoothing' | 'thinning') => Math.round((val(k) ?? 0) * 100)
function commit(k: SliderKey): void {
  const v = draft.value[k]
  if (v !== undefined) void set({ [k]: v })
}
const BUTTON_LABELS: Record<TabletButton, string> = { right: 'ПКМ', middle: 'СКМ', none: 'Нет' }
const BUTTONS = TABLET_BUTTONS.map((id) => ({ id, label: BUTTON_LABELS[id] }))
/** The curve: raw pressure → drawing pressure (SVG path in a 100×100 box). */
const curvePath = computed(() => {
  const p = { pmin: val('pmin') ?? 0, pmax: val('pmax') ?? 1, curve: val('curve') ?? 0 }
  const pts: string[] = []
  for (let i = 0; i <= 50; i++) {
    const r = i / 50
    pts.push(`${(r * 100).toFixed(1)},${(100 - pressureCurve(r, p) * 100).toFixed(1)}`)
  }
  return `M${pts.join(' L')}`
})
const rawNow = computed(() => (sample.value?.in ? sample.value.p : 0))
const curvedNow = computed(() => (prefs.value ? pressureCurve(rawNow.value, { pmin: val('pmin')!, pmax: val('pmax')!, curve: val('curve')! }) : 0))

// ---------- the test pad: the pen arrives as the mouse, the width from its pressure ----------
const pad = ref<HTMLCanvasElement>()
const padLive = ref<HTMLCanvasElement>()
/** The test pad is a "Qvarch canvas" too (the tablet's canvas target lands here while it is shown). */
const padBox = ref<HTMLElement>()
const padTarget = useTabletCanvas(padBox)
function sizePad(): void {
  for (const c of [pad.value, padLive.value]) {
    if (!c) continue
    const r = c.getBoundingClientRect()
    c.width = Math.round(r.width * devicePixelRatio)
    c.height = Math.round(r.height * devicePixelRatio)
  }
}
onMounted(sizePad)
const padSize = ref(6)
const ink = useInk({
  base: () => pad.value,
  live: () => padLive.value,
  style: () => ({ color: cssColor('--tablet-pad-ink'), size: padSize.value, streamline: val('streamline') ?? 0.55, smoothing: val('smoothing') ?? 0.6, thinning: val('thinning') ?? 0.55 }),
  keys: () => padTarget.isActive(),
})
function clearPad(): void {
  ink.snapshot()
  const c = pad.value
  c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
}

const statusText = computed(() => {
  const s = status.value
  switch (s.state) {
    case 'off':
      return 'Выключено'
    case 'starting':
      return 'Запуск…'
    case 'searching':
      return 'Планшет не найден'
    case 'connected':
      return s.device
    case 'error':
      return s.message
    default: {
      const never: never = s
      return never
    }
  }
})
</script>

<template>
  <div class="tv tw:group/tv tw:flex tw:flex-col tw:h-full tw:min-h-0 tw:[&.embedded]:h-auto tw:[&.embedded]:border tw:[&.embedded]:border-border tw:[&.embedded]:rounded-r3" :class="{ embedded }">
    <div class="bar tw:flex-none tw:flex tw:items-center tw:gap-12 tw:h-44 tw:py-0 tw:px-14 tw:border-b tw:border-b-border tw:text-[13px] tw:whitespace-nowrap">
      <b>Планшет</b>
      <span class="st tw:group/st tw:inline-flex tw:items-center tw:gap-6 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-muted tw:text-[12px] tw:[&.curve]:flex tw:[&.curve]:gap-12 tw:[&.curve]:mt-6" :class="status.state"><i class="tw:flex-none tw:w-7 tw:h-7 tw:rounded-[50%] tw:bg-dim tw:group-[.connected]/st:not-group-[.searching]/st:not-group-[.starting]/st:not-[.st.error_&]:bg-up tw:group-[.searching]/st:not-group-[.starting]/st:not-[.st.error_&]:bg-warn tw:group-[.starting]/st:not-[.st.error_&]:bg-warn tw:[.st.error_&]:bg-down"></i>{{ statusText }}</span>
      <span class="sp tw:flex-1"></span>
      <label class="sw tw:inline-flex tw:items-center tw:gap-7 tw:text-text-2 tw:text-[12.5px] tw:cursor-pointer" :title="prefs?.enabled ? 'Вернуть планшет Windows (после выключения перезапустите его кнопкой питания)' : 'Qvarch будет читать планшет сам'">
        <input class="tw:[accent-color:var(--accent)]" type="checkbox" :checked="prefs?.enabled" @change="toggle" />
        <span>Управлять через Qvarch</span>
      </label>
    </div>

    <div class="body tw:flex-1 tw:min-h-0 tw:overflow-auto tw:pt-12 tw:pr-14 tw:pb-16 tw:pl-14 tw:group-[.embedded]/tv:overflow-visible">
      <p v-if="replug" class="note warn tw:flex tw:items-center tw:gap-7 tw:mt-0 tw:mr-0 tw:mb-10 tw:ml-0 tw:text-[12.5px] tw:text-warn"><Icon name="refresh" :size="13" />Чтобы перо снова работало в Windows как раньше — выключите и включите планшет кнопкой питания.</p>
      <p v-if="!prefs?.enabled" class="note tw:flex tw:items-center tw:gap-7 tw:mt-0 tw:mr-0 tw:mb-10 tw:ml-0 tw:text-muted tw:text-[12.5px]">Перо будет работать как мышь на выбранном экране или только в окне Qvarch. Давление и наклон — в рисовании Qvarch.</p>

      <div class="fields tw:group/fields tw:grid tw:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] tw:gap-12" :class="{ off: !prefs?.enabled }">
        <!-- where -->
        <section class="tw:group-[.off]/fields:[&:not(.wide)]:opacity-[0.55] tw:min-w-0 tw:pt-10 tw:pr-12 tw:pb-12 tw:pl-12 tw:border tw:border-border tw:rounded-[4px] tw:bg-white/2">
          <h4 class="tw:flex tw:items-center tw:justify-between tw:mt-0 tw:mr-0 tw:mb-10 tw:ml-0 tw:whitespace-nowrap tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Где работает перо</h4>
          <div class="map tw:relative tw:h-130 tw:mb-10">
            <div v-if="!monitors.length" class="empty tw:flex tw:items-center tw:justify-center tw:h-full tw:border tw:border-dashed tw:border-border tw:rounded-[4px] tw:text-muted tw:text-[12px]">{{ prefs?.enabled ? 'Ищу экраны…' : 'Экраны появятся после включения' }}</div>
            <button v-for="m in monitors" :key="m.name" class="mon tw:absolute tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:m-0 tw:p-0 tw:border-2 tw:border-border-2 tw:rounded-r2 tw:bg-panel tw:text-muted tw:text-[11px] tw:overflow-hidden tw:box-border tw:[&.on]:border-accent tw:[&.on]:bg-accent/18 tw:hover:enabled:not-[&.on]:bg-hover tw:hover:enabled:not-[&.on]:border-border-3" :class="{ on: isMon(m) }" :style="monStyle(m)" :title="`${m.w}×${m.h}`" @click="set({ target: { kind: 'monitor', name: m.name } })">
              <b class="tw:text-[14px] tw:text-text">{{ monLabel(m) }}</b><small class="tw:text-[10px]">{{ m.w }}×{{ m.h }}</small><Icon v-if="m.primary" name="star" :size="10" />
            </button>
          </div>
          <div class="seg tw:inline-flex tw:flex-wrap tw:max-w-full tw:gap-2 tw:p-2 tw:rounded-[4px] tw:bg-white/5">
            <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi" :class="{ on: prefs?.target.kind === 'monitor' }" @click="set({ target: { kind: 'monitor', name: prefs?.target.kind === 'monitor' ? prefs.target.name : undefined } })"><Icon name="monitor" :size="13" />Монитор</button>
            <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi" :class="{ on: prefs?.target.kind === 'all' }" @click="set({ target: { kind: 'all' } })"><Icon name="display" :size="13" />Все</button>
            <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi" :class="{ on: prefs?.target.kind === 'window' }" title="Когда окно скрыто — главный монитор" @click="set({ target: { kind: 'window' } })"><Icon name="layers" :size="13" />Окно Qvarch</button>
            <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi" :class="{ on: prefs?.target.kind === 'canvas' }" title="Только видимая область открытой доски, как бы её ни двигали и ни масштабировали; доски нет — всё окно Qvarch" @click="set({ target: { kind: 'canvas' } })"><Icon name="penTool" :size="13" />Полотно Qvarch</button>
          </div>
        </section>

        <!-- the area -->
        <section class="tw:group-[.off]/fields:[&:not(.wide)]:opacity-[0.55] tw:min-w-0 tw:pt-10 tw:pr-12 tw:pb-12 tw:pl-12 tw:border tw:border-border tw:rounded-[4px] tw:bg-white/2">
          <h4 class="tw:flex tw:items-center tw:justify-between tw:mt-0 tw:mr-0 tw:mb-10 tw:ml-0 tw:whitespace-nowrap tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Область планшета</h4>
          <div class="tabwrap tw:flex tw:justify-center tw:h-130 tw:mb-10">
            <div class="tab tw:relative tw:h-full tw:max-w-full tw:border-2 tw:border-border-2 tw:rounded-[4px] tw:bg-bg" :style="{ aspectRatio: String(tabAspect) }">
              <div class="act tw:absolute tw:rounded-r2 tw:bg-accent/20 tw:[outline:1px_solid_rgb(var(--accent-rgb)/0.6)]" :style="areaStyle"></div>
              <span v-if="penDot" class="dot tw:absolute tw:w-8 tw:h-8 tw:-mt-4 tw:mr-0 tw:mb-0 tw:-ml-4 tw:rounded-[50%] tw:bg-accent-fg tw:[&.c]:bg-(--tablet-contact) tw:[&.c]:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--tablet-contact)_30%,transparent)]" :class="{ c: sample?.c }" :style="penDot"></span>
            </div>
          </div>
          <div class="row tw:flex tw:items-center tw:gap-10 tw:mt-8 tw:whitespace-nowrap">
            <span class="seg sm tw:inline-flex tw:flex-wrap tw:max-w-full tw:gap-2 tw:p-2 tw:rounded-[4px] tw:bg-white/5">
              <button class="tw:inline-flex tw:items-center tw:gap-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:h-24 tw:py-0 tw:px-8 tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi" v-for="r in ROTS" :key="r" :class="{ on: prefs?.rotation === r }" :title="`Планшет повёрнут на ${r}°`" @click="set({ rotation: r })">{{ r }}°</button>
            </span>
            <label class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12px]"><input class="tw:[accent-color:var(--accent)]" type="checkbox" :checked="prefs?.keepAspect" @change="set({ keepAspect: !prefs?.keepAspect })" />Пропорции экрана</label>
          </div>
        </section>

        <!-- the pen -->
        <section class="tw:group-[.off]/fields:[&:not(.wide)]:opacity-[0.55] tw:min-w-0 tw:pt-10 tw:pr-12 tw:pb-12 tw:pl-12 tw:border tw:border-border tw:rounded-[4px] tw:bg-white/2">
          <h4 class="tw:flex tw:items-center tw:justify-between tw:mt-0 tw:mr-0 tw:mb-10 tw:ml-0 tw:whitespace-nowrap tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Нажатие</h4>
          <label class="sl tw:flex tw:items-center tw:gap-8 tw:my-4 tw:mx-0 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap">
            <span>Клик от</span>
            <input class="tw:flex-1 tw:min-w-60 tw:[accent-color:var(--accent)]" type="range" min="1" max="40" :value="pct('click')" @input="drag('click', $event)" @change="commit('click')" />
            <em class="tw:w-34 tw:not-italic tw:text-right tw:tabular-nums tw:font-data tw:text-text-2">{{ pct('click') }}%</em>
          </label>
          <div class="curve tw:flex tw:gap-12 tw:mt-6">
            <svg class="tw:flex-none tw:w-92 tw:h-92 tw:border tw:border-border tw:rounded-r2 tw:bg-bg" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d="M0,100 L100,0" class="diag tw:[stroke:var(--border-2)] tw:stroke-1 tw:fill-none tw:[vector-effect:non-scaling-stroke]" />
              <path :d="curvePath" class="cv tw:[stroke:var(--accent-fg)] tw:stroke-2 tw:fill-none tw:[vector-effect:non-scaling-stroke]" />
              <line v-if="sample?.in" :x1="rawNow * 100" :x2="rawNow * 100" y1="0" y2="100" class="now tw:stroke-(--tablet-contact) tw:stroke-[1.5] tw:[vector-effect:non-scaling-stroke]" />
              <line :x1="pct('click')" :x2="pct('click')" y1="0" y2="100" class="clk tw:[stroke:var(--warn)] tw:stroke-1 tw:[stroke-dasharray:3_3] tw:[vector-effect:non-scaling-stroke]" />
            </svg>
            <div class="cvs tw:flex-1 tw:min-w-0">
              <label class="sl tw:flex tw:items-center tw:gap-8 tw:my-4 tw:mx-0 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap">
                <span>Мягче</span>
                <input class="tw:flex-1 tw:min-w-60 tw:[accent-color:var(--accent)]" type="range" min="-100" max="100" :value="Math.round((val('curve') ?? 0) * 100)" @input="drag('curve', $event)" @change="commit('curve')" />
                <span>Жёстче</span>
              </label>
              <label class="sl tw:flex tw:items-center tw:gap-8 tw:my-4 tw:mx-0 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap">
                <span>Минимум</span>
                <input class="tw:flex-1 tw:min-w-60 tw:[accent-color:var(--accent)]" type="range" min="0" max="30" :value="pct('pmin')" @input="drag('pmin', $event)" @change="commit('pmin')" />
                <em class="tw:w-34 tw:not-italic tw:text-right tw:tabular-nums tw:font-data tw:text-text-2">{{ pct('pmin') }}%</em>
              </label>
              <label class="sl tw:flex tw:items-center tw:gap-8 tw:my-4 tw:mx-0 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap">
                <span>Максимум</span>
                <input class="tw:flex-1 tw:min-w-60 tw:[accent-color:var(--accent)]" type="range" min="30" max="100" :value="pct('pmax')" @input="drag('pmax', $event)" @change="commit('pmax')" />
                <em class="tw:w-34 tw:not-italic tw:text-right tw:tabular-nums tw:font-data tw:text-text-2">{{ pct('pmax') }}%</em>
              </label>
            </div>
          </div>
          <div class="meter tw:h-6 tw:mt-10 tw:rounded-r2 tw:bg-panel-2 tw:overflow-hidden"><i class="tw:[.st.error_&]:bg-down tw:block tw:h-full tw:[background:linear-gradient(90deg,var(--accent),var(--tablet-contact))]" :style="{ width: `${curvedNow * 100}%` }"></i></div>
        </section>

        <section class="tw:group-[.off]/fields:[&:not(.wide)]:opacity-[0.55] tw:min-w-0 tw:pt-10 tw:pr-12 tw:pb-12 tw:pl-12 tw:border tw:border-border tw:rounded-[4px] tw:bg-white/2">
          <h4 class="tw:flex tw:items-center tw:justify-between tw:mt-0 tw:mr-0 tw:mb-10 tw:ml-0 tw:whitespace-nowrap tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Перо</h4>
          <div class="row tw:flex tw:items-center tw:gap-10 tw:mt-8 tw:whitespace-nowrap">
            <span class="lbl tw:w-66 tw:text-muted tw:text-[12px]">Кнопка 1</span>
            <span class="seg sm tw:inline-flex tw:flex-wrap tw:max-w-full tw:gap-2 tw:p-2 tw:rounded-[4px] tw:bg-white/5"><button class="tw:inline-flex tw:items-center tw:gap-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:h-24 tw:py-0 tw:px-8 tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi" v-for="b in BUTTONS" :key="b.id" :class="{ on: prefs?.button1 === b.id }" @click="set({ button1: b.id })">{{ b.label }}</button></span>
          </div>
          <div class="row tw:flex tw:items-center tw:gap-10 tw:mt-8 tw:whitespace-nowrap">
            <span class="lbl tw:w-66 tw:text-muted tw:text-[12px]">Кнопка 2</span>
            <span class="seg sm tw:inline-flex tw:flex-wrap tw:max-w-full tw:gap-2 tw:p-2 tw:rounded-[4px] tw:bg-white/5"><button class="tw:inline-flex tw:items-center tw:gap-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:h-24 tw:py-0 tw:px-8 tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi" v-for="b in BUTTONS" :key="b.id" :class="{ on: prefs?.button2 === b.id }" @click="set({ button2: b.id })">{{ b.label }}</button></span>
          </div>
          <div class="row tw:flex tw:items-center tw:gap-10 tw:mt-8 tw:whitespace-nowrap">
            <label class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12px]"><input class="tw:[accent-color:var(--accent)]" type="checkbox" :checked="prefs?.tilt" @change="set({ tilt: !prefs?.tilt })" />Наклон в рисовании Qvarch</label>
          </div>
          <div class="live tw:flex tw:flex-wrap tw:gap-y-4 tw:gap-x-12 tw:mt-12 tw:text-muted tw:text-[11.5px] tw:tabular-nums tw:font-data">
            <span class="tw:[&.on]:text-accent-fg" :class="{ on: sample?.in }">{{ sample?.in ? (sample.c ? 'касание' : 'в воздухе') : 'перо далеко' }}</span>
            <span>давление {{ Math.round(rawNow * 100) }}%</span>
            <span>наклон {{ sample?.in ? `${sample.tx}° / ${sample.ty}°` : '—' }}</span>
            <span>кнопки {{ sample?.in ? (sample.b & 1 ? '1' : '') + (sample.b & 2 ? '2' : '') || '—' : '—' }}</span>
          </div>
        </section>

        <section class="tw:group-[.off]/fields:[&:not(.wide)]:opacity-[0.55] tw:min-w-0 tw:pt-10 tw:pr-12 tw:pb-12 tw:pl-12 tw:border tw:border-border tw:rounded-[4px] tw:bg-white/2">
          <h4 class="tw:flex tw:items-center tw:justify-between tw:mt-0 tw:mr-0 tw:mb-10 tw:ml-0 tw:whitespace-nowrap tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Плавность линии</h4>
          <label class="sl tw:flex tw:items-center tw:gap-8 tw:my-4 tw:mx-0 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap" title="Насколько лениво линия следует за пером: больше — ровнее, но чуть отстаёт">
            <span class="w tw:w-112">Сглаживание</span>
            <input class="tw:flex-1 tw:min-w-60 tw:[accent-color:var(--accent)]" type="range" min="0" max="95" :value="pc('streamline')" @input="drag('streamline', $event)" @change="commit('streamline')" />
            <em class="tw:w-34 tw:not-italic tw:text-right tw:tabular-nums tw:font-data tw:text-text-2">{{ pc('streamline') }}%</em>
          </label>
          <label class="sl tw:flex tw:items-center tw:gap-8 tw:my-4 tw:mx-0 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap" title="Насколько скруглён контур линии">
            <span class="w tw:w-112">Скругление</span>
            <input class="tw:flex-1 tw:min-w-60 tw:[accent-color:var(--accent)]" type="range" min="0" max="100" :value="pc('smoothing')" @input="drag('smoothing', $event)" @change="commit('smoothing')" />
            <em class="tw:w-34 tw:not-italic tw:text-right tw:tabular-nums tw:font-data tw:text-text-2">{{ pc('smoothing') }}%</em>
          </label>
          <label class="sl tw:flex tw:items-center tw:gap-8 tw:my-4 tw:mx-0 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap" title="Насколько нажатие меняет толщину">
            <span class="w tw:w-112">От нажатия</span>
            <input class="tw:flex-1 tw:min-w-60 tw:[accent-color:var(--accent)]" type="range" min="0" max="90" :value="pc('thinning')" @input="drag('thinning', $event)" @change="commit('thinning')" />
            <em class="tw:w-34 tw:not-italic tw:text-right tw:tabular-nums tw:font-data tw:text-text-2">{{ pc('thinning') }}%</em>
          </label>
          <label class="sl tw:flex tw:items-center tw:gap-8 tw:my-4 tw:mx-0 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap">
            <span class="w tw:w-112">Толщина (проверка)</span>
            <input class="tw:flex-1 tw:min-w-60 tw:[accent-color:var(--accent)]" v-model.number="padSize" type="range" min="2" max="24" />
            <em class="tw:w-34 tw:not-italic tw:text-right tw:tabular-nums tw:font-data tw:text-text-2">{{ padSize }}</em>
          </label>
        </section>

        <section class="tw:group-[.off]/fields:[&:not(.wide)]:opacity-[0.55] tw:min-w-0 tw:pt-10 tw:pr-12 tw:pb-12 tw:pl-12 tw:border tw:border-border tw:rounded-[4px] tw:bg-white/2">
          <h4 class="tw:flex tw:items-center tw:justify-between tw:mt-0 tw:mr-0 tw:mb-10 tw:ml-0 tw:whitespace-nowrap tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Кнопки планшета <span class="raw tw:overflow-hidden tw:max-w-140 tw:text-dim tw:font-data tw:text-[10px] tw:font-normal tw:text-ellipsis" :title="'Последний отчёт кнопок: ' + (auxRaw || '—')">{{ auxRaw ? auxRaw.slice(3, 17) : '' }}</span></h4>
          <div v-for="(k, i) in prefs?.keys ?? []" :key="i" class="krow tw:flex tw:items-center tw:gap-8 tw:my-4 tw:mx-0 tw:whitespace-nowrap">
            <span class="kled tw:flex-none tw:w-8 tw:h-8 tw:rounded-[50%] tw:bg-border-2 tw:[&.on]:bg-up tw:[&.on]:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--up)_25%,transparent)]" :class="{ on: keysMask & (1 << i) }"></span>
            <b class="tw:w-22 tw:text-text-2 tw:text-[12px]">K{{ i + 1 }}</b>
            <button
              class="kcap tw:flex-1 tw:min-w-90 tw:max-w-180 tw:h-26 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-r2 tw:bg-white/3 tw:text-text-hi tw:font-data tw:text-[12px] tw:text-left tw:[&.rec]:border-accent tw:[&.rec]:bg-accent/15 tw:[&.rec]:text-accent-fg tw:hover:enabled:not-[&.rec]:bg-hover tw:hover:enabled:not-[&.rec]:border-border-3"
              :class="{ rec: recording === i }"
              :title="recording === i ? 'Нажмите сочетание; Delete — убрать, Esc — отмена' : 'Нажмите, чтобы записать сочетание'"
              @click="startRecord(i)"
              @keydown="recording === i && onRecordKey($event, i)"
              @keyup="onRecordUp(i)"
              @blur="recording === i && (recording = undefined)"
            >
              {{ recording === i ? recorded || 'Нажмите сочетание…' : k || '—' }}
            </button>
            <small class="tw:overflow-hidden tw:text-muted tw:text-[11px] tw:text-ellipsis">{{ KEY_HINTS[i] }}</small>
          </div>
        </section>

        <!-- try it -->
        <section class="wide tw:group-[.off]/fields:[&:not(.wide)]:opacity-[0.55] tw:min-w-0 tw:pt-10 tw:pr-12 tw:pb-12 tw:pl-12 tw:border tw:border-border tw:rounded-[4px] tw:bg-white/2 tw:col-span-full">
          <h4 class="tw:flex tw:items-center tw:justify-between tw:mt-0 tw:mr-0 tw:mb-10 tw:ml-0 tw:whitespace-nowrap tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Проверка <span class="padacts tw:inline-flex tw:gap-12"><button class="lnk tw:p-0 tw:border-0 tw:bg-transparent tw:text-accent-fg tw:text-[11.5px] tw:font-normal tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Ctrl+Z" @click="ink.undo()">Отменить</button><button class="lnk tw:p-0 tw:border-0 tw:bg-transparent tw:text-accent-fg tw:text-[11.5px] tw:font-normal tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="clearPad">Очистить</button></span></h4>
          <div ref="padBox" class="padw tw:relative tw:h-240 tw:rounded-[4px] tw:bg-text-hi" @pointerdown="padTarget.report()">
            <canvas class="tw:absolute tw:inset-0 tw:w-full tw:h-full tw:cursor-crosshair tw:touch-none" ref="pad"></canvas>
            <canvas class="tw:absolute tw:inset-0 tw:w-full tw:h-full tw:cursor-crosshair tw:touch-none" ref="padLive" @pointerdown="ink.down" @pointermove="ink.move" @pointerup="ink.up" @pointercancel="ink.up"></canvas>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
