import { computed, ref, watch, type Ref, type ShallowRef } from 'vue'
import { isDarkPaper, type Board, type ShapeStyle } from '@shared/whiteboard'
import type { TabletState } from '@shared/tablet'
import { penNow } from '../../lib/tablet'
import type { FrameScheduler } from './frames'
import type { StrokeStyle } from './scene'
import { clampSize, inkColors, readToolPrefs, saveToolPrefs, type ToolPrefs } from './toolPrefs'
import { TOOLS } from './tools'

/**
 * The current tool and its settings (remembered for every board): its size (the wheel, the presets), its colour
 * and palette (light ink on dark paper), the stroke it draws.
 */
export function useToolPrefs(board: ShallowRef<Board>, tablet: Ref<TabletState | undefined>, frames: FrameScheduler, onColorPicked: (c: string) => void) {
  const tp = ref<ToolPrefs>(readToolPrefs())
  watch(
    tp,
    (v) => {
      saveToolPrefs(v)
      frames.schedule()
    },
    { deep: true },
  )
  /** The current tool's description (the registry's entry). */
  const spec = computed(() => TOOLS[tp.value.tool])
  const dark = computed(() => isDarkPaper(board.value.bg.color))

  /** The current tool's size spec (none — a tool without a size). */
  const sized = computed(() => spec.value.size)
  const size = computed(() => (sized.value ? tp.value[sized.value.key] : 0))
  function setSize(s: number): void {
    const z = sized.value
    if (z) tp.value[z.key] = clampSize(z, s)
  }

  const usesColor = computed(() => !!spec.value.color)
  const palette = computed(() => (spec.value.color?.palette ?? inkColors)(dark.value))
  const colorKey = () => spec.value.color?.key ?? 'penColor'
  const color = computed(() => tp.value[colorKey()])
  function setColor(c: string): void {
    tp.value[colorKey()] = c
    onColorPicked(c)
  }
  const hasOptions = computed(() => spec.value.options.length > 0)

  /** The nib's angle now: the tablet pen's tilt turns it, else the set one. */
  function nibAngleNow(): number {
    const p = penNow()
    if (p && (p.tiltX || p.tiltY)) return Math.round(((Math.atan2(p.tiltY, p.tiltX) * 180) / Math.PI + 90 + 360) % 180)
    return tp.value.nibAngle
  }
  /** The stroke the current (ink) tool draws now. */
  const strokeStyle = (): StrokeStyle => spec.value.stroke!(tp.value, tablet.value?.prefs, nibAngleNow)
  /** What a new shape takes from the shape tool. */
  const shapeStyle = (): ShapeStyle => ({ kind: tp.value.shapeKind, color: tp.value.penColor, width: tp.value.shapeWidth, fill: tp.value.shapeFill, dash: tp.value.shapeDash })

  return { tp, spec, dark, sized, size, setSize, usesColor, palette, color, setColor, hasOptions, strokeStyle, shapeStyle }
}
export type BoardTools = ReturnType<typeof useToolPrefs>
