<script setup lang="ts">
import { computed } from 'vue'
import Popover from '../Popover.vue'
import { useBoard } from './boardContext'
import type { OptionSection } from './tools'

/** The current tool's options (a popover by its button): the nib's angle, opacity, the pressure gradient, the eraser's and shapes' switches. */
defineProps<{ anchor?: HTMLElement }>()
const open = defineModel<boolean>('open', { required: true })
const { tools } = useBoard()
const { tp, spec, hasOptions } = tools
/** Shown while open and the tool has options at all. */
const shown = computed({ get: () => open.value && hasOptions.value, set: (on) => (open.value = on) })
const has = (s: OptionSection) => spec.value.options.includes(s)
/** The tool's opacity setting (pen or marker). */
const opacityKey = computed(() => spec.value.opacityKey ?? 'penOpacity')
</script>

<template>
  <Popover v-model:open="shown" :anchor="anchor" :width="250" align-left :chrome="40" max-height="none" class="bd-pop bd-opt tw:pt-8 tw:pr-10 tw:pb-10 tw:pl-10 tw:border tw:border-white/10 tw:rounded-r3 tw:bg-panel tw:[box-shadow:0_16px_40px_rgba(0,0,0,0.5)] tw:text-text tw:text-[12px]">
      <template v-if="has('nibAngle')">
        <label class="bgr tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap">
          <span class="bl tw:flex-none tw:w-58 tw:text-muted">Угол пера</span>
          <input class="tw:flex-1 tw:min-w-0 tw:[accent-color:var(--accent)]" v-model.number="tp.nibAngle" type="range" min="0" max="179" step="1" />
          <em class="tw:w-34 tw:not-italic tw:text-right tw:text-text-2 tw:tabular-nums tw:font-data">{{ tp.nibAngle }}°</em>
        </label>
        <p class="ohint tw:mt-4 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[11px]">С наклоном пера планшета угол берётся из наклона. Alt — прямая линия.</p>
      </template>
      <template v-if="has('opacity')">
        <label class="bgr tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap">
          <span class="bl tw:flex-none tw:w-58 tw:text-muted">Прозрачн.</span>
          <input class="tw:flex-1 tw:min-w-0 tw:[accent-color:var(--accent)]" v-model.number="tp[opacityKey]" type="range" min="0.05" max="1" step="0.05" />
          <em class="tw:w-34 tw:not-italic tw:text-right tw:text-text-2 tw:tabular-nums tw:font-data">{{ Math.round(tp[opacityKey] * 100) }}%</em>
        </label>
      </template>
      <template v-if="has('gradient')">
        <label class="bgr chk2 tw:text-text-2 tw:cursor-pointer tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap"><input class="tw:[accent-color:var(--accent)]" v-model="tp.gradient" type="checkbox" />Градиент по нажиму</label>
        <div v-if="tp.gradient" class="bgr tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap">
          <span class="bl tw:flex-none tw:w-58 tw:text-muted">Цвета</span>
          <span class="grad tw:flex-1 tw:h-10 tw:rounded-r2" :style="{ background: `linear-gradient(90deg, ${tp.penColor}, ${tp.gradColor})` }"></span>
          <label class="col pick tw:relative tw:w-18 tw:h-18 tw:p-0 tw:border-2 tw:border-transparent tw:rounded-r1 tw:[box-shadow:0_0_0_1px_rgba(255,255,255,0.25)] tw:flex-none tw:overflow-hidden tw:[background:var(--swatch-wheel)] tw:cursor-pointer" title="Второй цвет — при сильном нажиме" :style="{ background: tp.gradColor }"><input class="tw:absolute tw:inset-0 tw:opacity-0 tw:cursor-pointer tw:[.chk_&]:[accent-color:var(--accent)]" v-model="tp.gradColor" type="color" /></label>
        </div>
        <p v-if="tp.gradient" class="ohint tw:mt-4 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[11px]">Лёгкое нажатие — цвет пера, сильное — второй цвет</p>
      </template>
      <template v-if="has('eraser')">
        <label class="bgr chk2 tw:text-text-2 tw:cursor-pointer tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap"><input class="tw:[accent-color:var(--accent)]" v-model="tp.eraseWhole" type="checkbox" />Стирать линии целиком</label>
        <label class="bgr chk2 tw:text-text-2 tw:cursor-pointer tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap"><input class="tw:[accent-color:var(--accent)]" v-model="tp.eraserPressure" type="checkbox" />Размер от нажима пера</label>
      </template>
      <template v-if="has('shape')">
        <label class="bgr chk2 tw:text-text-2 tw:cursor-pointer tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap"><input class="tw:[accent-color:var(--accent)]" v-model="tp.shapeFill" type="checkbox" />Заливка</label>
        <label class="bgr chk2 tw:text-text-2 tw:cursor-pointer tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap"><input class="tw:[accent-color:var(--accent)]" v-model="tp.shapeDash" type="checkbox" />Пунктир</label>
      </template>
  </Popover>
</template>
