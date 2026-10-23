<script setup lang="ts">
import { computed } from 'vue'
import { kinds } from '../lib/palette'
import { pointPlace, usePopover } from '../lib/usePopover'
import Icon from './Icon.vue'

/**
 * Right-click menu "what kind of activity is this?". Fixed-positioned and clamped into `bounds`
 * (the island passes its panel rect — anything outside it would be click-through). Over everything (teleported);
 * closed by a click elsewhere, Esc, or anything scrolling (it stood by what has moved).
 */
const props = defineProps<{
  x: number
  y: number
  title?: string
  current?: string
  /** No kinds to pick (an Outlook meeting) — only what the slot has. */
  noKinds?: boolean
  bounds?: { left: number; top: number; right: number; bottom: number }
}>()
const emit = defineEmits<{ pick: [kind: string]; close: [] }>()

const open = computed({ get: () => true, set: (on) => void (on || emit('close')) })
const { panelRef, style } = usePopover(() => ({ x: props.x, y: props.y }), { place: pointPlace(4, { w: 200, h: 240 }, () => props.bounds) }, open)
</script>

<template>
  <Teleport to="body">
  <div :ref="panelRef" class="kmenu tw:fixed tw:z-5000 tw:min-w-190 tw:p-5 tw:flex tw:flex-col tw:bg-panel-2 tw:border tw:border-border tw:rounded-[4px] tw:[box-shadow:var(--shadow-menu)] tw:animate-[KindMenu-pop_0.12s_cubic-bezier(0.32,0.72,0,1)]" :style="style" @contextmenu.prevent>
    <div v-if="title" class="ttl tw:pt-4 tw:pr-8 tw:pb-6 tw:pl-8 tw:text-[11px] tw:text-muted">{{ title }}</div>
    <button class="tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-5 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:hover:not-[&.cur]:bg-hover tw:[&.cur]:bg-accent/18 tw:hover:enabled:border-border-3" v-for="k in noKinds ? [] : kinds.filter((x) => !x.hidden || x.id === current)" :key="k.id" :class="{ cur: k.id === current }" @click="emit('pick', k.id)">
      <span class="ic tw:inline-flex tw:items-center tw:justify-center tw:w-20 tw:h-20 tw:rounded-r2 tw:text-text-hi" :style="{ background: k.color }"><Icon :name="k.icon" :size="12" :stroke="2.2" /></span>
      {{ k.label }}
    </button>
    <slot />
  </div>
  </Teleport>
</template>
