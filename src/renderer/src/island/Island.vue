<script setup lang="ts">
import SeriesAsk from '../components/SeriesAsk.vue'
import { provideIsland } from './islandState'
import IslandPanel from './panel/IslandPanel.vue'
import IslandPill from './pill/IslandPill.vue'

/**
 * The floating island: a pill (or a slim pill stuck to a screen edge) that morphs into the day panel on hover.
 * The window is fixed and transparent; the shell's size animates. State: islandState.ts.
 */
const { els, expand, layout, onKey } = provideIsland()
const { expanded } = expand
const { up, dock, size, shellTop, bgAlpha } = layout
</script>

<template>
  <SeriesAsk class="" />
  <div class="stage tw:group/stage tw:fixed tw:inset-0 tw:flex tw:justify-center tw:items-start tw:pointer-events-none tw:[&.up]:not-[&.dock-left]:not-[&.dock-right]:items-end tw:[&.dock-left]:not-[&.dock-right]:justify-start tw:[&.dock-left]:not-[&.dock-right]:items-start tw:[&.dock-right]:justify-end tw:[&.dock-right]:items-start tw:[.mini>&]:absolute tw:[.mini>&]:top-0 tw:[.mini>&]:bottom-0" :class="[{ up }, dock ? `dock-${dock}` : '']" @keydown="onKey">
    <div :ref="els.shell" class="shell tw:group-[.dock-top]/stage:[border-top-width:0] tw:group-[.dock-top]/stage:not-group-[.dock-left]/stage:rounded-tl-none tw:group-[.dock-top]/stage:not-group-[.dock-right]/stage:rounded-tr-none tw:group-[.dock-bottom]/stage:[border-bottom-width:0] tw:group-[.dock-bottom]/stage:not-group-[.dock-left]/stage:rounded-bl-none tw:group-[.dock-bottom]/stage:not-group-[.dock-right]/stage:rounded-br-none tw:group-[.dock-left]/stage:[border-left-width:0] tw:group-[.dock-left]/stage:rounded-tl-none tw:group-[.dock-left]/stage:rounded-bl-none tw:group-[.dock-right]/stage:[border-right-width:0] tw:group-[.dock-right]/stage:rounded-tr-none tw:group-[.dock-right]/stage:rounded-br-none tw:[.stage[class*='dock-']_&]:[&:not(.expanded)]:not-group-[.dock-top]/stage:not-group-[.dock-bottom]/stage:not-group-[.dock-left]/stage:not-group-[.dock-right]/stage:rounded-r3 tw:group-[.dock-top]/stage:[&:not(.expanded)]:not-group-[.dock-bottom]/stage:not-group-[.dock-left]/stage:not-group-[.dock-right]/stage:rounded-[0_0_var(--r3)_var(--r3)] tw:group-[.dock-bottom]/stage:[&:not(.expanded)]:not-group-[.dock-left]/stage:not-group-[.dock-right]/stage:rounded-[var(--r3)_var(--r3)_0_0] tw:group-[.dock-left]/stage:[&:not(.expanded)]:not-group-[.dock-right]/stage:rounded-[0_var(--r3)_var(--r3)_0] tw:[&&]:group-[.dock-right]/stage:[&:not(.expanded)]:rounded-[var(--r3)_0_0_var(--r3)] tw:relative tw:pointer-events-auto tw:bg-[color-mix(in_srgb,var(--island-bg)_calc(var(--bga,1)*100%),transparent)] tw:border tw:border-[color-mix(in_srgb,var(--island-line)_calc(var(--bga,1)*100%),transparent)] tw:rounded-r3 tw:[box-shadow:inset_0_2px_0_rgb(var(--accent-rgb)/calc(0.9*var(--bga,1)))] tw:overflow-hidden tw:text-text tw:[transition:width_0.42s_cubic-bezier(0.32,0.72,0,1),height_0.42s_cubic-bezier(0.32,0.72,0,1),border-radius_0.42s_cubic-bezier(0.32,0.72,0,1),background-color_0.25s_ease] tw:will-change-[width,height] tw:[&.expanded]:not-group-[.dock-top]/stage:not-group-[.dock-bottom]/stage:not-group-[.dock-left]/stage:not-group-[.dock-right]/stage:rounded-r3" :class="{ expanded }" :style="{ width: `${size.w}px`, height: `${size.h}px`, marginTop: `${shellTop}px`, '--bga': bgAlpha }">
      <!-- ===== collapsed pill ===== -->
      <Transition name="ifade">
        <IslandPill v-if="!expanded" />
      </Transition>

      <!-- ===== expanded panel ===== -->
      <Transition name="ifade">
        <IslandPanel v-if="expanded" />
      </Transition>
    </div>
  </div>
</template>

<style scoped src="./Island.css"></style>
