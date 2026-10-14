<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import '@fontsource/caveat/400.css'
import '@fontsource/marck-script/400.css'
import '@fontsource/bad-script/400.css'
import '@fontsource/neucha/400.css'
import Icon from './Icon.vue'

/**
 * A signature (or anything handwritten — a date, initials): drawn with the mouse / a pen, typed in a
 * handwriting font, or taken from a picture (a scan — its white background can go). Saved as a PNG with a
 * transparent background, cut to what is there.
 */
const emit = defineEmits<{ save: [url: string]; close: [] }>()

type Mode = 'draw' | 'type' | 'image'
const mode = ref<Mode>('draw')
const COLORS = ['#111827', '#1d3fa8', '#b91c1c']
const color = ref(COLORS[1])
const width = ref(2.6)
const FONTS = [
  { id: 'Caveat', label: 'Caveat', scale: 1.15 },
  { id: 'Marck Script', label: 'Marck', scale: 1 },
  { id: 'Bad Script', label: 'Bad Script', scale: 0.9 },
  { id: 'Neucha', label: 'Neucha', scale: 1 },
]
const font = ref(FONTS[0].id)
const text = ref('')
const textIn = ref<HTMLInputElement>()

const canvas = ref<HTMLCanvasElement>()
const drawn = ref(false)
let ctx: CanvasRenderingContext2D | null = null
let drawing = false
let pts: Array<{ x: number; y: number }> = []
const W = 560
const H = 240
const DPR = Math.max(2, window.devicePixelRatio || 1)

function setup(): void {
  const c = canvas.value
  if (!c) return
  c.width = W * DPR
  c.height = H * DPR
  ctx = c.getContext('2d')
  ctx?.scale(DPR, DPR)
}
onMounted(setup)
watch(mode, async (m) => {
  await nextTick()
  if (m === 'draw') {
    setup()
    drawn.value = false
  } else if (m === 'type') textIn.value?.focus()
})

// ---------- drawing ----------
function at(e: PointerEvent) {
  const r = canvas.value!.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}
function down(e: PointerEvent): void {
  if (!ctx) return
  drawing = true
  canvas.value!.setPointerCapture(e.pointerId)
  pts = [at(e)]
  ctx.strokeStyle = color.value
  ctx.fillStyle = color.value
  ctx.lineWidth = width.value
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // a dot when only clicked
  ctx.beginPath()
  ctx.arc(pts[0].x, pts[0].y, width.value / 2, 0, Math.PI * 2)
  ctx.fill()
  drawn.value = true
}
function move(e: PointerEvent): void {
  if (!drawing || !ctx) return
  const p = at(e)
  pts.push(p)
  if (pts.length < 3) return
  // a smooth line: through the midpoints, the points are the curve's controls
  const [a, b, c] = pts.slice(-3)
  const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const m2 = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 }
  ctx.beginPath()
  ctx.moveTo(m1.x, m1.y)
  ctx.quadraticCurveTo(b.x, b.y, m2.x, m2.y)
  ctx.stroke()
}
function up(): void {
  drawing = false
  pts = []
}

// ---------- a picture ----------
const img = ref<HTMLImageElement>()
const imgUrl = ref('')
const knockWhite = ref(true)
const imgIn = ref<HTMLInputElement>()
async function openImage(f: File | undefined): Promise<void> {
  if (!f || !f.type.startsWith('image/')) return
  const url = await new Promise<string>((res) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.readAsDataURL(f)
  })
  const i = new Image()
  i.src = url
  await i.decode()
  img.value = i
  imgUrl.value = url
  if (imgIn.value) imgIn.value.value = ''
}
function onImageDrop(e: DragEvent): void {
  void openImage(e.dataTransfer?.files?.[0])
}

const clear = (): void => {
  if (mode.value === 'draw') {
    ctx?.clearRect(0, 0, W, H)
    drawn.value = false
  } else if (mode.value === 'type') text.value = ''
  else {
    img.value = undefined
    imgUrl.value = ''
  }
}
const ready = computed(() => (mode.value === 'draw' ? drawn.value : mode.value === 'type' ? !!text.value.trim() : !!img.value))

/** Cuts a canvas to its visible pixels (+ a little air) → PNG. */
function trimmed(c: HTMLCanvasElement, pad: number): string | undefined {
  const g = c.getContext('2d')!
  const data = g.getImageData(0, 0, c.width, c.height).data
  let x0 = c.width
  let y0 = c.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (data[(y * c.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return undefined
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(c.width - 1, x1 + pad)
  y1 = Math.min(c.height - 1, y1 + pad)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1
  out.height = y1 - y0 + 1
  out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out.toDataURL('image/png')
}

/** The typed text in the font, large (crisp on the page at any size). */
async function typedCanvas(): Promise<HTMLCanvasElement> {
  const f = FONTS.find((x) => x.id === font.value) ?? FONTS[0]
  const size = Math.round(110 * f.scale)
  const spec = `${size}px "${f.id}"`
  await document.fonts.load(spec, text.value)
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  g.font = spec
  const w = Math.ceil(g.measureText(text.value).width) + size
  c.width = Math.min(8000, w)
  c.height = Math.round(size * 1.8)
  const g2 = c.getContext('2d')!
  g2.font = spec
  g2.fillStyle = color.value
  g2.textBaseline = 'middle'
  g2.fillText(text.value.trim(), size / 2, c.height / 2)
  return c
}

/** The picture, at most 1600 px wide; near-white pixels become transparent (a scan of a signature on paper). */
function imageCanvas(): HTMLCanvasElement {
  const i = img.value!
  const k = Math.min(1, 1600 / i.naturalWidth)
  const c = document.createElement('canvas')
  c.width = Math.round(i.naturalWidth * k)
  c.height = Math.round(i.naturalHeight * k)
  const g = c.getContext('2d')!
  g.drawImage(i, 0, 0, c.width, c.height)
  if (knockWhite.value) {
    const d = g.getImageData(0, 0, c.width, c.height)
    for (let p = 0; p < d.data.length; p += 4) {
      const l = Math.min(d.data[p], d.data[p + 1], d.data[p + 2])
      // white → clear, light grey → partly, ink stays
      if (l > 235) d.data[p + 3] = 0
      else if (l > 190) d.data[p + 3] = Math.round((d.data[p + 3] * (235 - l)) / 45)
    }
    g.putImageData(d, 0, 0)
  }
  return c
}

async function save(): Promise<void> {
  if (!ready.value) return
  let url: string | undefined
  if (mode.value === 'draw' && canvas.value) url = trimmed(canvas.value, Math.round(6 * DPR))
  else if (mode.value === 'type') url = trimmed(await typedCanvas(), 10)
  else url = trimmed(imageCanvas(), 6)
  if (url) emit('save', url)
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
  else if (e.key === 'Enter' && mode.value === 'type' && ready.value) void save()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="sp-back" @pointerdown.self="emit('close')">
      <div class="sp">
        <div class="sph">
          <b>Подпись</b>
          <span class="tabs">
            <button :class="{ on: mode === 'draw' }" @click="mode = 'draw'"><Icon name="signature" :size="13" />Нарисовать</button>
            <button :class="{ on: mode === 'type' }" @click="mode = 'type'"><span class="tt">T</span>Текст</button>
            <button :class="{ on: mode === 'image' }" @click="mode = 'image'"><Icon name="upload" :size="13" />Загрузить</button>
          </span>
          <span class="grow"></span>
          <button class="x" title="Закрыть" @click="emit('close')"><Icon name="x" :size="14" /></button>
        </div>

        <div class="tools">
          <template v-if="mode !== 'image'">
            <span class="cols">
              <button v-for="c in COLORS" :key="c" class="col" :class="{ on: color === c }" :style="{ background: c }" @click="color = c"></button>
              <label class="col pick" :class="{ on: !COLORS.includes(color) }" title="Свой цвет" :style="!COLORS.includes(color) ? { background: color } : undefined">
                <input v-model="color" type="color" />
              </label>
            </span>
            <label v-if="mode === 'draw'" class="wd" title="Толщина"><input v-model.number="width" type="range" min="1" max="6" step="0.2" /></label>
            <span v-else class="fonts">
              <button v-for="f in FONTS" :key="f.id" :class="{ on: font === f.id }" :style="{ fontFamily: `'${f.id}'` }" :title="f.label" @click="font = f.id">Аа</button>
            </span>
          </template>
          <label v-else class="chk"><input v-model="knockWhite" type="checkbox" />Убрать белый фон</label>
        </div>

        <canvas
          v-if="mode === 'draw'"
          ref="canvas"
          class="pad"
          :style="{ width: `${W}px`, height: `${H}px` }"
          @pointerdown="down"
          @pointermove="move"
          @pointerup="up"
          @pointercancel="up"
        ></canvas>
        <div v-else-if="mode === 'type'" class="pad typed" :style="{ width: `${W}px`, height: `${H}px` }">
          <input
            ref="textIn"
            v-model="text"
            placeholder="Иванов И.И."
            spellcheck="false"
            :style="{ fontFamily: `'${font}'`, color, fontSize: `${Math.round(56 * (FONTS.find((f) => f.id === font)?.scale ?? 1))}px` }"
          />
          <span class="line"></span>
        </div>
        <div v-else class="pad drop" :style="{ width: `${W}px`, height: `${H}px` }" @dragover.prevent @drop.prevent="onImageDrop" @click="imgIn?.click()">
          <img v-if="imgUrl" :src="imgUrl" alt="" :class="{ knock: knockWhite }" />
          <span v-else class="hint"><Icon name="upload" :size="20" />Перетащите картинку или нажмите</span>
          <input ref="imgIn" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="openImage(($event.target as HTMLInputElement).files?.[0])" />
        </div>

        <div class="spf">
          <span class="grow"></span>
          <button class="bt" :disabled="!ready" @click="clear">Очистить</button>
          <button class="bt pri" :disabled="!ready" @click="save">Сохранить</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sp-back {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 80px;
  background: rgba(5, 7, 12, 0.55);
}
.sp {
  padding: 12px 14px 14px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #171a24;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  color: var(--text);
}
.sph,
.spf,
.tools {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
}
.sph {
  margin-bottom: 10px;
  font-size: 13px;
}
.tools {
  height: 30px;
  margin-bottom: 8px;
}
.spf {
  margin-top: 10px;
}
.grow {
  flex: 1;
}
.tabs {
  display: inline-flex;
  gap: 2px;
  margin-left: 8px;
  padding: 2px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.05);
}
.tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #9aa3b8;
  font-size: 12px;
}
.tabs button.on {
  background: rgba(139, 124, 255, 0.22);
  color: #e0dcff;
}
.tt {
  font-family: Georgia, serif;
  font-size: 14px;
  line-height: 1;
}
.pad {
  display: block;
  border-radius: 10px;
  background: #fff;
  cursor: crosshair;
  touch-action: none;
}
.typed {
  position: relative;
  display: flex;
  align-items: center;
  cursor: text;
}
.typed input {
  width: 100%;
  padding: 0 28px;
  border: 0;
  outline: 0;
  background: transparent;
  text-align: center;
}
.typed input::placeholder {
  color: #c9ccd6;
}
.line {
  position: absolute;
  left: 28px;
  right: 28px;
  bottom: 62px;
  height: 1px;
  background: #93a4d8;
  pointer-events: none;
}
.drop {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background-image: linear-gradient(45deg, #eef0f4 25%, transparent 25%), linear-gradient(-45deg, #eef0f4 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #eef0f4 75%), linear-gradient(-45deg, transparent 75%, #eef0f4 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.drop img {
  max-width: 92%;
  max-height: 92%;
}
.drop img.knock {
  mix-blend-mode: multiply;
}
.hint {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #6b7280;
  font-size: 13px;
}
.cols {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.col {
  position: relative;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35);
}
.col.on {
  border-color: #c4b5fd;
}
.col.pick {
  overflow: hidden;
  background: conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444);
  cursor: pointer;
}
.col.pick input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.wd input {
  width: 90px;
  accent-color: #8b7cff;
}
.fonts {
  display: inline-flex;
  gap: 4px;
}
.fonts button {
  height: 28px;
  min-width: 40px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
  color: #d6dae6;
  font-size: 19px;
  line-height: 1;
}
.fonts button.on {
  border-color: #8b7cff;
  background: rgba(139, 124, 255, 0.18);
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #c3c8d6;
  font-size: 12.5px;
}
.chk input {
  accent-color: #8b7cff;
}
.x {
  display: inline-flex;
  padding: 5px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #9aa3b8;
}
.x:hover {
  background: rgba(255, 255, 255, 0.08);
}
.bt {
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.08);
  color: #d6dae6;
  font-size: 12.5px;
}
.bt.pri {
  background: #6d5df0;
  color: #fff;
}
.bt:disabled {
  opacity: 0.45;
}
</style>
