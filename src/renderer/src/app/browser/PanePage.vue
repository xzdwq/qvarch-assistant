<script setup lang="ts">
import type { BPane } from '../../lib/browser'
import { useBrowserView } from './browserViewContext'
import DeviceBar from './DeviceBar.vue'
import PageError from './PageError.vue'
import StartPage from './StartPage.vue'

/**
 * A pane's page box: the native page goes over it (its box reported); else the start page or the error; the device
 * mode's bar and frame; the page's picture while something of the app is over it; the docked developer tools.
 */
defineProps<{ p: BPane }>()
const view = useBrowserView()
const { byId, isBlank, pageShown } = view.tabs
const { devFits, shots, devH, devW, devSide, dragDev, devRef, areaRef, pageRef } = view.layout
</script>

<template>
  <div class="page tw:group/page tw:[&.dright]:flex-row tw:flex-1 tw:min-h-0 tw:flex tw:flex-col tw:bg-bg" :class="{ dright: devSide === 'right' && byId(p.active)?.devtools }">
  <div :ref="(el) => pageRef(p.id, el)" class="pg tw:relative tw:flex-1 tw:min-h-0 tw:overflow-hidden tw:[container:pg/inline-size]">
    <div v-if="byId(p.active)?.loading" class="lbar tw:absolute tw:top-0 tw:left-0 tw:right-0 tw:z-2 tw:h-2 tw:[background:linear-gradient(90deg,transparent,var(--accent),transparent)] tw:[&&]:bg-size-[50%_100%] tw:animate-[BrowserView-bv-load_1s_linear_infinite]"></div>
    <!-- the start page -->
    <StartPage v-if="p.active && isBlank(byId(p.active)?.url)" />
    <!-- the page did not open -->
    <PageError v-else-if="byId(p.active)?.error" :p="p" />
    <!-- the device mode: its bar, and the device's page in the middle -->
    <template v-if="p.active && pageShown(p.active) && byId(p.active)?.device">
      <template v-for="dv in [byId(p.active)!.device!]" :key="p.active">
        <DeviceBar :p="p" :dv="dv" />
        <div :ref="(el) => areaRef(p.id, el)" class="darea tw:absolute tw:inset-[34px_0_0] tw:overflow-hidden tw:[background:repeating-linear-gradient(45deg,var(--device-stripe)_0_8px,transparent_8px_16px),var(--bg)]">
          <div v-if="devFits[p.id]" class="dframe tw:absolute tw:bg-white tw:[box-shadow:0_0_0_1px_var(--border-2),var(--device-frame-shadow)]" :style="{ left: devFits[p.id].x + 'px', top: devFits[p.id].y + 'px', width: devFits[p.id].w + 'px', height: devFits[p.id].h + 'px' }">
            <img v-if="shots[p.active]" class="shot tw:absolute tw:inset-0 tw:z-3 tw:w-full tw:h-full tw:object-fill" :src="`data:image/jpeg;base64,${shots[p.active]}`" alt="" />
          </div>
        </div>
      </template>
    </template>
    <!-- the page's picture while something of the app is over it -->
    <img v-if="p.active && shots[p.active] && !byId(p.active)?.device" class="shot tw:absolute tw:inset-0 tw:z-3 tw:w-full tw:h-full tw:object-fill" :src="`data:image/jpeg;base64,${shots[p.active]}`" alt="" />
  </div>
  <!-- the developer tools, docked under the page -->
  <template v-if="p.active && pageShown(p.active) && byId(p.active)?.devtools">
    <div class="dgrip tw:group-[.dright]/page:w-5 tw:group-[.dright]/page:h-auto tw:group-[.dright]/page:cursor-col-resize tw:flex-none tw:h-5 tw:bg-border tw:cursor-row-resize tw:hover:bg-accent/85" title="Потяните — высота инструментов разработчика" @pointerdown="dragDev"></div>
    <div :ref="(el) => devRef(p.id, el)" class="dv tw:relative tw:flex-none tw:bg-panel" :style="devSide === 'right' ? { width: devW + 'px' } : { height: devH + 'px' }">
      <img v-if="shots[p.active + ':dev']" class="shot tw:absolute tw:inset-0 tw:z-3 tw:w-full tw:h-full tw:object-fill" :src="`data:image/jpeg;base64,${shots[p.active + ':dev']}`" alt="" />
    </div>
  </template>
  </div>
</template>
