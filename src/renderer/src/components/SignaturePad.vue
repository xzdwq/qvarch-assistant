<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import '@fontsource/caveat/400.css'
import '@fontsource/marck-script/400.css'
import '@fontsource/bad-script/400.css'
import '@fontsource/neucha/400.css'
import Icon from './Icon.vue'
import { useTablet, useTabletCanvas, useTabletLive } from '../lib/tablet'
import { DEFAULT_INK, useInk } from '../lib/ink'
import { cssPalette } from '../lib/cssPalette'

/**
 * A signature (or anything handwritten — a date, initials): drawn with the mouse / a pen, typed in a
 * handwriting font, or taken from a picture (a scan — its white background can go). Saved as a PNG with a
 * transparent background, cut to what is there.
 */
const emit = defineEmits<{ save: [url: string]; close: [] }>()
// a pen tablet run by Qvarch: the width follows its pressure
useTabletLive()
const { state: tablet } = useTablet()

/** The ways to make a signature (the tabs), in order. */
const MODES = [
  { id: 'draw', label: 'Нарисовать', icon: 'signature' },
  { id: 'type', label: 'Текст' },
  { id: 'image', label: 'Загрузить', icon: 'upload' },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon?: string }>
type Mode = (typeof MODES)[number]['id']
const mode = ref<Mode>('draw')
// the ink swatches (theme CSS); the one picked goes into the signature's picture
const COLORS = cssPalette('--sign-ink')
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
const liveCv = ref<HTMLCanvasElement>()
// the tablet's "Qvarch canvas" — the pad while it is open
const padBox = ref<HTMLElement>()
useTabletCanvas(padBox)
const drawn = ref(false)
const W = 560
const H = 240
const DPR = Math.max(2, window.devicePixelRatio || 1)

function setup(): void {
  for (const cv of [canvas.value, liveCv.value]) {
    if (!cv) continue
    cv.width = W * DPR
    cv.height = H * DPR
  }
}
onMounted(setup)
watch(mode, async (m) => {
  await nextTick()
  MODE_OPS[m].enter?.()
})

// ---------- drawing: smooth ink (lib/ink), the smoothing from the tablet's settings ----------
const ink = useInk({
  base: () => canvas.value,
  live: () => liveCv.value,
  style: () => {
    const p = tablet.value?.prefs
    return { color: color.value, size: width.value * 1.9, streamline: p?.streamline ?? DEFAULT_INK.streamline, smoothing: p?.smoothing ?? DEFAULT_INK.smoothing, thinning: p?.thinning ?? DEFAULT_INK.thinning }
  },
  onStroke: () => (drawn.value = true),
  onHistory: (left) => (drawn.value = left > 0),
  // the pad is a dialog over everything: Ctrl+Z here while it is open on the drawing tab
  keys: () => mode.value === 'draw',
})

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

/** What each mode does: on being opened, on «Очистить»; whether it has something to save, and its picture (PNG). */
interface ModeOps {
  enter?: () => void
  clear: () => void
  ready: () => boolean
  picture: () => Promise<string | undefined>
}
const MODE_OPS: Record<Mode, ModeOps> = {
  draw: {
    enter: () => {
      setup()
      drawn.value = false
    },
    clear: () => {
      ink.snapshot()
      canvas.value?.getContext('2d')?.clearRect(0, 0, W * DPR, H * DPR)
      drawn.value = false
    },
    ready: () => drawn.value,
    picture: async () => (canvas.value ? trimmed(canvas.value, Math.round(6 * DPR)) : undefined),
  },
  type: {
    enter: () => textIn.value?.focus(),
    clear: () => (text.value = ''),
    ready: () => !!text.value.trim(),
    picture: async () => trimmed(await typedCanvas(), 10),
  },
  image: {
    clear: () => {
      img.value = undefined
      imgUrl.value = ''
    },
    ready: () => !!img.value,
    picture: async () => trimmed(imageCanvas(), 6),
  },
}
const clear = (): void => MODE_OPS[mode.value].clear()
const ready = computed(() => MODE_OPS[mode.value].ready())

async function save(): Promise<void> {
  if (!ready.value) return
  const url = await MODE_OPS[mode.value].picture()
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
    <div class="sp-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:items-start tw:justify-center tw:pt-80 tw:bg-bg/55" @pointerdown.self="emit('close')">
      <div class="sp tw:pt-12 tw:pr-14 tw:pb-14 tw:pl-14 tw:rounded-r3 tw:border tw:border-white/10 tw:bg-panel tw:[box-shadow:0_24px_60px_rgba(0,0,0,0.6)] tw:text-text">
        <div class="sph tw:flex tw:items-center tw:gap-10 tw:whitespace-nowrap tw:mb-10 tw:text-[13px]">
          <b>Подпись</b>
          <span class="tabs tw:inline-flex tw:gap-2 tw:ml-8 tw:p-2 tw:rounded-[4px] tw:bg-white/5">
            <button v-for="m in MODES" :key="m.id" class="tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi" :class="{ on: mode === m.id }" @click="mode = m.id">
              <Icon v-if="'icon' in m" :name="m.icon" :size="13" /><span v-else class="tt tw:font-[Georgia,serif] tw:text-[14px] tw:leading-none">T</span>{{ m.label }}
            </button>
          </span>
          <span class="grow tw:flex-1"></span>
          <button class="x tw:inline-flex tw:p-5 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-white/8 tw:hover:enabled:border-border-3" title="Закрыть" @click="emit('close')"><Icon name="x" :size="14" /></button>
        </div>

        <div class="tools tw:flex tw:items-center tw:gap-10 tw:whitespace-nowrap tw:h-30 tw:mb-8">
          <template v-if="mode !== 'image'">
            <span class="cols tw:inline-flex tw:items-center tw:gap-6">
              <button v-for="c in COLORS" :key="c" class="col tw:relative tw:w-20 tw:h-20 tw:p-0 tw:border-2 tw:border-transparent tw:rounded-[50%] tw:[box-shadow:0_0_0_1px_rgba(255,255,255,0.35)] tw:[&.on]:border-accent-fg tw:hover:enabled:not-[&.on]:border-border-3" :class="{ on: color === c }" :style="{ background: c }" @click="color = c"></button>
              <label class="col pick tw:relative tw:w-20 tw:h-20 tw:p-0 tw:border-2 tw:border-transparent tw:rounded-[50%] tw:[box-shadow:0_0_0_1px_rgba(255,255,255,0.35)] tw:[&.on]:border-accent-fg tw:overflow-hidden tw:[background:var(--swatch-wheel)] tw:cursor-pointer" :class="{ on: !COLORS.includes(color) }" title="Свой цвет" :style="!COLORS.includes(color) ? { background: color } : undefined">
                <input class="tw:absolute tw:inset-0 tw:opacity-0 tw:cursor-pointer" v-model="color" type="color" />
              </label>
            </span>
            <label v-if="mode === 'draw'" class="wd" title="Толщина"><input class="tw:w-90 tw:[accent-color:var(--accent)]" v-model.number="width" type="range" min="1" max="6" step="0.2" /></label>
            <span v-else class="fonts tw:inline-flex tw:gap-4">
              <button class="tw:h-28 tw:min-w-40 tw:py-0 tw:px-8 tw:border tw:border-transparent tw:rounded-r2 tw:bg-white/6 tw:text-text tw:text-[19px] tw:leading-none tw:[&.on]:border-accent tw:[&.on]:bg-accent/18" v-for="f in FONTS" :key="f.id" :class="{ on: font === f.id }" :style="{ fontFamily: `'${f.id}'` }" :title="f.label" @click="font = f.id">Аа</button>
            </span>
          </template>
          <label v-else class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12.5px]"><input class="tw:[accent-color:var(--accent)]" v-model="knockWhite" type="checkbox" />Убрать белый фон</label>
        </div>

        <div v-if="mode === 'draw'" ref="padBox" class="pad ink tw:block tw:rounded-[4px] tw:bg-text-hi tw:cursor-crosshair tw:touch-none tw:relative" :style="{ width: `${W}px`, height: `${H}px` }">
          <canvas class="tw:absolute tw:inset-0 tw:w-full tw:h-full tw:rounded-[4px]" ref="canvas"></canvas>
          <canvas class="tw:absolute tw:inset-0 tw:w-full tw:h-full tw:rounded-[4px]" ref="liveCv" @pointerdown="ink.down" @pointermove="ink.move" @pointerup="ink.up" @pointercancel="ink.up"></canvas>
        </div>
        <div v-else-if="mode === 'type'" class="pad typed tw:rounded-[4px] tw:bg-text-hi tw:touch-none tw:relative tw:flex tw:items-center tw:cursor-text" :style="{ width: `${W}px`, height: `${H}px` }">
          <input class="tw:w-full tw:py-0 tw:px-28 tw:border-0 tw:outline-none tw:bg-transparent tw:text-center tw:placeholder:text-text-2"
            ref="textIn"
            v-model="text"
            placeholder="Иванов И.И."
            spellcheck="false"
            :style="{ fontFamily: `'${font}'`, color, fontSize: `${Math.round(56 * (FONTS.find((f) => f.id === font)?.scale ?? 1))}px` }"
          />
          <span class="line tw:absolute tw:left-28 tw:right-28 tw:bottom-62 tw:h-1 tw:bg-accent tw:pointer-events-none"></span>
        </div>
        <div v-else class="pad drop tw:rounded-[4px] tw:bg-text-hi tw:touch-none tw:flex tw:items-center tw:justify-center tw:cursor-pointer tw:[&&]:bg-[linear-gradient(45deg,var(--text-hi)_25%,transparent_25%),linear-gradient(-45deg,var(--text-hi)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--text-hi)_75%),linear-gradient(-45deg,transparent_75%,var(--text-hi)_75%)] tw:[&&]:bg-size-[16px_16px] tw:[&&]:bg-position-[0_0,0_8px,8px_-8px,-8px_0]" :style="{ width: `${W}px`, height: `${H}px` }" @dragover.prevent @drop.prevent="onImageDrop" @click="imgIn?.click()">
          <img class="tw:max-w-[92%] tw:max-h-[92%] tw:[&.knock]:mix-blend-multiply" v-if="imgUrl" :src="imgUrl" alt="" :class="{ knock: knockWhite }" />
          <span v-else class="hint tw:inline-flex tw:items-center tw:gap-8 tw:text-dim tw:text-[13px]"><Icon name="upload" :size="20" />Перетащите картинку или нажмите</span>
          <input ref="imgIn" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="openImage(($event.target as HTMLInputElement).files?.[0])" />
        </div>

        <div class="spf tw:flex tw:items-center tw:gap-10 tw:whitespace-nowrap tw:mt-10">
          <span class="grow tw:flex-1"></span>
          <button class="bt tw:h-32 tw:py-0 tw:px-14 tw:border-0 tw:rounded-[4px] tw:bg-white/8 tw:text-text tw:text-[12.5px] tw:disabled:opacity-45 tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :disabled="!ready" @click="clear">Очистить</button>
          <button class="bt pri tw:h-32 tw:py-0 tw:px-14 tw:border-0 tw:rounded-[4px] tw:text-[12.5px] tw:bg-accent tw:text-on-accent tw:disabled:opacity-45 tw:hover:enabled:border-border-3" :disabled="!ready" @click="save">Сохранить</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
