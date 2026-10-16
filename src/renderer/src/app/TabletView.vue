<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { activeArea, comboOf, monitorsBounds, pressureCurve, TABLET_MM, type TabletButton, type TabletMonitor, type TabletPrefs, type TabletRotation } from '@shared/tablet'
import Icon from '../components/Icon.vue'
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
  if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) return void (recording.value = undefined)
  if ((e.code === 'Delete' || e.code === 'Backspace') && !e.ctrlKey && !e.altKey && !e.shiftKey) return void saveKey(i, '')
  const c = comboOf(e)
  recorded.value = c
  // a real key (not only modifiers) ends the recording
  if (c && !/^(Ctrl|Shift|Alt|Win)(\+(Ctrl|Shift|Alt|Win))*$/.test(c)) saveKey(i, c)
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
  const p = prefs.value
  if (!p) return { w: 16, h: 9 }
  if (p.target.kind === 'all') return mapBox.value
  if (p.target.kind === 'canvas') return state.value?.canvas ?? { w: window.innerWidth * devicePixelRatio, h: window.innerHeight * devicePixelRatio }
  if (p.target.kind === 'window') return { w: window.innerWidth * devicePixelRatio, h: window.innerHeight * devicePixelRatio }
  const name = p.target.name || primaryName.value
  return monitors.value.find((m) => m.name === name) ?? { w: 16, h: 9 }
})

// ---------- the tablet area ----------
const turned = computed(() => prefs.value?.rotation === 90 || prefs.value?.rotation === 270)
const tabAspect = computed(() => (turned.value ? TABLET_MM.h / TABLET_MM.w : TABLET_MM.w / TABLET_MM.h))
const area = computed(() => activeArea(prefs.value?.rotation ?? 0, !!prefs.value?.keepAspect, targetSize.value.w, targetSize.value.h))
const areaStyle = computed(() => {
  const [x0, y0, x1, y1] = area.value
  return { left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }
})
const penDot = computed(() => (sample.value?.in ? { left: `${sample.value.x * 100}%`, top: `${sample.value.y * 100}%` } : undefined))
const ROTS: TabletRotation[] = [0, 90, 180, 270]

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
const BUTTONS: Array<{ id: TabletButton; label: string }> = [
  { id: 'right', label: 'ПКМ' },
  { id: 'middle', label: 'СКМ' },
  { id: 'none', label: 'Нет' },
]
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
  style: () => ({ color: '#1d3fa8', size: padSize.value, streamline: val('streamline') ?? 0.55, smoothing: val('smoothing') ?? 0.6, thinning: val('thinning') ?? 0.55 }),
  keys: () => padTarget.isActive(),
})
function clearPad(): void {
  ink.snapshot()
  const c = pad.value
  c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
}

const statusText = computed(() => {
  const s = status.value
  if (s.state === 'off') return 'Выключено'
  if (s.state === 'starting') return 'Запуск…'
  if (s.state === 'searching') return 'Планшет не найден'
  if (s.state === 'connected') return s.device
  return s.message
})
</script>

<template>
  <div class="tv" :class="{ embedded }">
    <div class="bar">
      <b>Планшет</b>
      <span class="st" :class="status.state"><i></i>{{ statusText }}</span>
      <span class="sp"></span>
      <label class="sw" :title="prefs?.enabled ? 'Вернуть планшет Windows (после выключения перезапустите его кнопкой питания)' : 'Qvarch будет читать планшет сам'">
        <input type="checkbox" :checked="prefs?.enabled" @change="toggle" />
        <span>Управлять через Qvarch</span>
      </label>
    </div>

    <div class="body">
      <p v-if="replug" class="note warn"><Icon name="refresh" :size="13" />Чтобы перо снова работало в Windows как раньше — выключите и включите планшет кнопкой питания.</p>
      <p v-if="!prefs?.enabled" class="note">Перо будет работать как мышь на выбранном экране или только в окне Qvarch. Давление и наклон — в рисовании Qvarch.</p>

      <div class="grid" :class="{ off: !prefs?.enabled }">
        <!-- where -->
        <section>
          <h4>Где работает перо</h4>
          <div class="map">
            <div v-if="!monitors.length" class="empty">{{ prefs?.enabled ? 'Ищу экраны…' : 'Экраны появятся после включения' }}</div>
            <button v-for="m in monitors" :key="m.name" class="mon" :class="{ on: isMon(m) }" :style="monStyle(m)" :title="`${m.w}×${m.h}`" @click="set({ target: { kind: 'monitor', name: m.name } })">
              <b>{{ monLabel(m) }}</b><small>{{ m.w }}×{{ m.h }}</small><Icon v-if="m.primary" name="star" :size="10" />
            </button>
          </div>
          <div class="seg">
            <button :class="{ on: prefs?.target.kind === 'monitor' }" @click="set({ target: { kind: 'monitor', name: prefs?.target.kind === 'monitor' ? prefs.target.name : undefined } })"><Icon name="monitor" :size="13" />Монитор</button>
            <button :class="{ on: prefs?.target.kind === 'all' }" @click="set({ target: { kind: 'all' } })"><Icon name="display" :size="13" />Все</button>
            <button :class="{ on: prefs?.target.kind === 'window' }" title="Когда окно скрыто — главный монитор" @click="set({ target: { kind: 'window' } })"><Icon name="layers" :size="13" />Окно Qvarch</button>
            <button :class="{ on: prefs?.target.kind === 'canvas' }" title="Только видимая область открытой доски, как бы её ни двигали и ни масштабировали; доски нет — всё окно Qvarch" @click="set({ target: { kind: 'canvas' } })"><Icon name="penTool" :size="13" />Полотно Qvarch</button>
          </div>
        </section>

        <!-- the area -->
        <section>
          <h4>Область планшета</h4>
          <div class="tabwrap">
            <div class="tab" :style="{ aspectRatio: String(tabAspect) }">
              <div class="act" :style="areaStyle"></div>
              <span v-if="penDot" class="dot" :class="{ c: sample?.c }" :style="penDot"></span>
            </div>
          </div>
          <div class="row">
            <span class="seg sm">
              <button v-for="r in ROTS" :key="r" :class="{ on: prefs?.rotation === r }" :title="`Планшет повёрнут на ${r}°`" @click="set({ rotation: r })">{{ r }}°</button>
            </span>
            <label class="chk"><input type="checkbox" :checked="prefs?.keepAspect" @change="set({ keepAspect: !prefs?.keepAspect })" />Пропорции экрана</label>
          </div>
        </section>

        <!-- the pen -->
        <section>
          <h4>Нажатие</h4>
          <label class="sl">
            <span>Клик от</span>
            <input type="range" min="1" max="40" :value="pct('click')" @input="drag('click', $event)" @change="commit('click')" />
            <em>{{ pct('click') }}%</em>
          </label>
          <div class="curve">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d="M0,100 L100,0" class="diag" />
              <path :d="curvePath" class="cv" />
              <line v-if="sample?.in" :x1="rawNow * 100" :x2="rawNow * 100" y1="0" y2="100" class="now" />
              <line :x1="pct('click')" :x2="pct('click')" y1="0" y2="100" class="clk" />
            </svg>
            <div class="cvs">
              <label class="sl">
                <span>Мягче</span>
                <input type="range" min="-100" max="100" :value="Math.round((val('curve') ?? 0) * 100)" @input="drag('curve', $event)" @change="commit('curve')" />
                <span>Жёстче</span>
              </label>
              <label class="sl">
                <span>Минимум</span>
                <input type="range" min="0" max="30" :value="pct('pmin')" @input="drag('pmin', $event)" @change="commit('pmin')" />
                <em>{{ pct('pmin') }}%</em>
              </label>
              <label class="sl">
                <span>Максимум</span>
                <input type="range" min="30" max="100" :value="pct('pmax')" @input="drag('pmax', $event)" @change="commit('pmax')" />
                <em>{{ pct('pmax') }}%</em>
              </label>
            </div>
          </div>
          <div class="meter"><i :style="{ width: `${curvedNow * 100}%` }"></i></div>
        </section>

        <section>
          <h4>Перо</h4>
          <div class="row">
            <span class="lbl">Кнопка 1</span>
            <span class="seg sm"><button v-for="b in BUTTONS" :key="b.id" :class="{ on: prefs?.button1 === b.id }" @click="set({ button1: b.id })">{{ b.label }}</button></span>
          </div>
          <div class="row">
            <span class="lbl">Кнопка 2</span>
            <span class="seg sm"><button v-for="b in BUTTONS" :key="b.id" :class="{ on: prefs?.button2 === b.id }" @click="set({ button2: b.id })">{{ b.label }}</button></span>
          </div>
          <div class="row">
            <label class="chk"><input type="checkbox" :checked="prefs?.tilt" @change="set({ tilt: !prefs?.tilt })" />Наклон в рисовании Qvarch</label>
          </div>
          <div class="live">
            <span :class="{ on: sample?.in }">{{ sample?.in ? (sample.c ? 'касание' : 'в воздухе') : 'перо далеко' }}</span>
            <span>давление {{ Math.round(rawNow * 100) }}%</span>
            <span>наклон {{ sample?.in ? `${sample.tx}° / ${sample.ty}°` : '—' }}</span>
            <span>кнопки {{ sample?.in ? (sample.b & 1 ? '1' : '') + (sample.b & 2 ? '2' : '') || '—' : '—' }}</span>
          </div>
        </section>

        <section>
          <h4>Плавность линии</h4>
          <label class="sl" title="Насколько лениво линия следует за пером: больше — ровнее, но чуть отстаёт">
            <span class="w">Сглаживание</span>
            <input type="range" min="0" max="95" :value="pc('streamline')" @input="drag('streamline', $event)" @change="commit('streamline')" />
            <em>{{ pc('streamline') }}%</em>
          </label>
          <label class="sl" title="Насколько скруглён контур линии">
            <span class="w">Скругление</span>
            <input type="range" min="0" max="100" :value="pc('smoothing')" @input="drag('smoothing', $event)" @change="commit('smoothing')" />
            <em>{{ pc('smoothing') }}%</em>
          </label>
          <label class="sl" title="Насколько нажатие меняет толщину">
            <span class="w">От нажатия</span>
            <input type="range" min="0" max="90" :value="pc('thinning')" @input="drag('thinning', $event)" @change="commit('thinning')" />
            <em>{{ pc('thinning') }}%</em>
          </label>
          <label class="sl">
            <span class="w">Толщина (проверка)</span>
            <input v-model.number="padSize" type="range" min="2" max="24" />
            <em>{{ padSize }}</em>
          </label>
        </section>

        <section>
          <h4>Кнопки планшета <span class="raw" :title="'Последний отчёт кнопок: ' + (auxRaw || '—')">{{ auxRaw ? auxRaw.slice(3, 17) : '' }}</span></h4>
          <div v-for="(k, i) in prefs?.keys ?? []" :key="i" class="krow">
            <span class="kled" :class="{ on: keysMask & (1 << i) }"></span>
            <b>K{{ i + 1 }}</b>
            <button
              class="kcap"
              :class="{ rec: recording === i }"
              :title="recording === i ? 'Нажмите сочетание; Delete — убрать, Esc — отмена' : 'Нажмите, чтобы записать сочетание'"
              @click="startRecord(i)"
              @keydown="recording === i && onRecordKey($event, i)"
              @keyup="onRecordUp(i)"
              @blur="recording === i && (recording = undefined)"
            >
              {{ recording === i ? recorded || 'Нажмите сочетание…' : k || '—' }}
            </button>
            <small>{{ KEY_HINTS[i] }}</small>
          </div>
        </section>

        <!-- try it -->
        <section class="wide">
          <h4>Проверка <span class="padacts"><button class="lnk" title="Ctrl+Z" @click="ink.undo()">Отменить</button><button class="lnk" @click="clearPad">Очистить</button></span></h4>
          <div ref="padBox" class="padw" @pointerdown="padTarget.report()">
            <canvas ref="pad"></canvas>
            <canvas ref="padLive" @pointerdown="ink.down" @pointermove="ink.move" @pointerup="ink.up" @pointercancel="ink.up"></canvas>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tv {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 44px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  white-space: nowrap;
}
.sp {
  flex: 1;
}
.st {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
  font-size: 12px;
}
.st i {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dim);
}
.st.connected i {
  background: var(--up);
}
.st.searching i,
.st.starting i {
  background: var(--warn);
}
.st.error i {
  background: var(--down);
}
.sw {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
}
.sw input,
.chk input {
  accent-color: var(--accent);
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px 16px;
}
.note {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 10px;
  color: var(--muted);
  font-size: 12.5px;
}
.note.warn {
  color: var(--warn);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.grid.off section:not(.wide) {
  opacity: 0.55;
}
section {
  min-width: 0;
  padding: 10px 12px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
}
section.wide {
  grid-column: 1 / -1;
}
h4 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 10px;
  white-space: nowrap;
  font-size: 11px;
  font-family: var(--font-data);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
}
.map {
  position: relative;
  height: 130px;
  margin-bottom: 10px;
}
.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  border: 1px dashed var(--border);
  border-radius: 4px;
  color: var(--muted);
  font-size: 12px;
}
.mon {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  margin: 0;
  padding: 0;
  border: 2px solid var(--border-2);
  border-radius: var(--r2);
  background: var(--panel);
  color: var(--muted);
  font-size: 11px;
  overflow: hidden;
  box-sizing: border-box;
}
.mon b {
  font-size: 14px;
  color: var(--text);
}
.mon small {
  font-size: 10px;
}
.mon.on {
  border-color: var(--accent);
  background: rgb(var(--accent-rgb) / 0.18);
}
.seg {
  display: inline-flex;
  flex-wrap: wrap;
  max-width: 100%;
  gap: 2px;
  padding: 2px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
}
.seg button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.seg.sm button {
  height: 24px;
  padding: 0 8px;
}
.seg button.on {
  background: rgb(var(--accent-rgb) / 0.22);
  color: var(--text-hi);
}
.tabwrap {
  display: flex;
  justify-content: center;
  height: 130px;
  margin-bottom: 10px;
}
.tab {
  position: relative;
  height: 100%;
  max-width: 100%;
  border: 2px solid var(--border-2);
  border-radius: 4px;
  background: var(--bg);
}
.act {
  position: absolute;
  border-radius: var(--r2);
  background: rgb(var(--accent-rgb) / 0.2);
  outline: 1px solid rgb(var(--accent-rgb) / 0.6);
}
.dot {
  position: absolute;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  background: var(--accent-fg);
}
.dot.c {
  background: #f472b6;
  box-shadow: 0 0 0 3px rgba(244, 114, 182, 0.3);
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  white-space: nowrap;
}
.lbl {
  width: 66px;
  color: var(--muted);
  font-size: 12px;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
  font-size: 12px;
}
.sl {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
  color: var(--muted);
  font-size: 11.5px;
  white-space: nowrap;
}
.sl input {
  flex: 1;
  min-width: 60px;
  accent-color: var(--accent);
}
.sl em {
  width: 34px;
  font-style: normal;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  color: var(--text-2);
}
.curve {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}
.curve svg {
  flex: none;
  width: 92px;
  height: 92px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--bg);
}
.cvs {
  flex: 1;
  min-width: 0;
}
.diag {
  stroke: var(--border-2);
  stroke-width: 1;
  fill: none;
  vector-effect: non-scaling-stroke;
}
.cv {
  stroke: var(--accent-fg);
  stroke-width: 2;
  fill: none;
  vector-effect: non-scaling-stroke;
}
.now {
  stroke: #f472b6;
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.clk {
  stroke: var(--warn);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  vector-effect: non-scaling-stroke;
}
.meter {
  height: 6px;
  margin-top: 10px;
  border-radius: var(--r2);
  background: var(--panel-2);
  overflow: hidden;
}
.meter i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent), #f472b6);
}
.live {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 12px;
  color: var(--muted);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.live .on {
  color: var(--accent-fg);
}
.padw {
  position: relative;
  height: 240px;
  border-radius: 4px;
  background: var(--text-hi);
}
.padw canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
  touch-action: none;
}
.sl .w {
  width: 112px;
}
.lnk {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-fg);
  font-size: 11.5px;
  font-weight: 400;
}
.raw {
  overflow: hidden;
  max-width: 140px;
  color: var(--dim);
  font-family: var(--font-data);
  font-size: 10px;
  font-weight: 400;
  text-overflow: ellipsis;
}
.krow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
  white-space: nowrap;
}
.krow b {
  width: 22px;
  color: var(--text-2);
  font-size: 12px;
}
.krow small {
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  text-overflow: ellipsis;
}
.kled {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-2);
}
.kled.on {
  background: var(--up);
  box-shadow: 0 0 0 3px rgba(0, 230, 118, 0.25);
}
.kcap {
  flex: 1;
  min-width: 90px;
  max-width: 180px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-hi);
  font-family: var(--font-data);
  font-size: 12px;
  text-align: left;
}
.kcap.rec {
  border-color: var(--accent);
  background: rgb(var(--accent-rgb) / 0.15);
  color: var(--accent-fg);
}
.tv.embedded {
  height: auto;
  border: 1px solid var(--border);
  border-radius: var(--r3);
}
.tv.embedded .body {
  overflow: visible;
}
.padacts {
  display: inline-flex;
  gap: 12px;
}
</style>
