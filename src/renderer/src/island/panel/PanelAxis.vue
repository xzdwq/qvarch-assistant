<script setup lang="ts">
import { formatHM } from '@shared/timeline'
import { useIsland } from '../islandState'

/** The time axis over the track: ticks, schedule marks, "Сейчас"; a click resets the selection. */
const { day, track, pick } = useIsland()
const { now } = day
const { axis, pct, to } = track
const { resetSelection } = pick
</script>

<template>
  <div class="axis tw:relative tw:h-18 tw:mt-4 tw:text-[10.5px] tw:text-muted tw:cursor-pointer" @click="resetSelection">
    <i v-for="t in axis.minor" :key="`m${t}`" class="tk minor tw:absolute tw:-bottom-1 tw:w-1 tw:h-4 tw:bg-white/28 tw:inline-block tw:rounded-[50%] tw:flex-none" :style="{ left: `${pct(t)}%` }"></i>
    <i v-for="t in axis.all" :key="`M${t}`" class="tk tw:absolute tw:-bottom-1 tw:w-1 tw:h-6 tw:bg-white/45 tw:inline-block tw:rounded-[50%] tw:flex-none" :style="{ left: `${pct(t)}%` }"></i>
    <span class="tw:absolute tw:[transform:translateX(-50%)] tw:whitespace-nowrap tw:tabular-nums tw:font-data tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" v-for="t in axis.list" :key="t" :style="{ left: `${pct(t)}%` }">{{ formatHM(t) }}</span>
    <span class="tw:[&.handle]:cursor-move tw:[&.handle]:not-[&.pfill]:not-[&.pwave]:flex-none tw:[&.handle]:not-[.abar_&]:flex tw:[&.handle]:items-center tw:[&.handle]:justify-center tw:[&.handle]:not-[&.pwave]:w-32 tw:[&.handle]:not-[&.pwave]:not-[.abar_&]:h-32 tw:[&.handle]:not-[&.uncut]:not-[.abar_&]:rounded-[4px] tw:[&.handle]:not-[&.sch]:not-[&.lunch]:text-dim tw:[&.handle]:bg-white/4 tw:[&.pfill]:not-[&.pwave]:flex-1 tw:[&.pwave]:flex-[1_1_0] tw:[&.pwave]:w-0 tw:[&.pwave]:min-w-20 tw:[&.pwave]:not-[.abar_&]:h-14 tw:absolute tw:[transform:translateX(-50%)] tw:whitespace-nowrap tw:tabular-nums tw:font-data tw:[&.sch]:not-[&.lunch]:text-accent-fg tw:[&.lunch]:text-warn-fg tw:[&.uncut]:not-[.abar_&]:rounded-r2 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2 tw:[&.empty]:m-6 tw:[&.empty]:text-[12px]" v-for="m in axis.marks" :key="m.text" :class="m.cls" :style="{ left: `${pct(m.t)}%` }">{{ m.text }}</span>
    <span v-if="now <= to" class="nowlbl tw:absolute tw:[transform:translateX(-50%)] tw:whitespace-nowrap tw:tabular-nums tw:font-data tw:text-down-fg tw:font-semibold tw:bg-bg/95 tw:py-0 tw:px-4 tw:z-1 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :style="{ left: `${Math.min(pct(now), 88)}%` }">Сейчас {{ formatHM(now) }}</span>
  </div>
</template>
