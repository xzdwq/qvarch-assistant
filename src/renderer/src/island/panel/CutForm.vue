<script setup lang="ts">
import { formatHM } from '@shared/timeline'
import DictateButton from '../../components/DictateButton.vue'
import Icon from '../../components/Icon.vue'
import OffsetField from '../../components/OffsetField.vue'
import QuickField from '../../components/QuickField.vue'
import TaskPicker from '../../components/TaskPicker.vue'
import TimeRange from '../../components/TimeRange.vue'
import { useIsland } from '../islandState'

/**
 * The cut row: the period (marker, or the free time by default), the quick line with dictation, tasks and the ±
 * dial, apply + the kinds; under it what was saved, or the calls noticed that are not labelled yet.
 */
const state = useIsland()
const { els, toast } = state
const { today, shownKinds } = state.day
const { marker, implicit, activeEnd, setPeriod, resetSelection, planPeriod, dial, onDial } = state.pick
const { kind, label, saving, cutTasks, cutParsed, detectedCalls, pickKind, useCall, cut } = state.cut
</script>

<template>
  <div class="details tw:flex tw:flex-col tw:gap-10">
    <div class="times tw:flex tw:items-center tw:gap-6 tw:min-h-28 tw:text-[13px]">
      <template v-if="marker">
        <span class="muted tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">Период</span>
        <TimeRange class="tw:[.abar_&]:block tw:[.abar_&]:not-[&.boxed]:h-full tw:[.abar_&]:not-[&.boxed]:rounded-r2" boxed :start="marker.start" :end="activeEnd" :live-end="!marker.end" @change="setPeriod" />
        <button class="icon tw:inline-flex tw:items-center tw:bg-transparent tw:border-0 tw:py-4 tw:px-5 tw:text-muted tw:hover:text-text-hi tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent" title="Сбросить выделение (Esc)" @click="resetSelection"><Icon name="x" :size="15" /></button>
      </template>
      <template v-else-if="implicit">
        <!-- free work time by default (or an hour forward); changing a time turns it into an explicit period -->
        <span class="muted tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">Период</span>
        <TimeRange class="tw:[.abar_&]:block tw:[.abar_&]:not-[&.boxed]:h-full tw:[.abar_&]:not-[&.boxed]:rounded-r2" boxed :start="implicit.start" :end="activeEnd" :live-end="!implicit.end" @change="setPeriod" />
        <span class="muted small tw:text-[11px] tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ implicit.end ? 'вперёд' : 'свободно' }}</span>
      </template>
      <template v-else>
        <span class="muted tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">Всё размечено.</span>
        <button class="linkbtn tw:border-0 tw:bg-transparent tw:text-accent-fg tw:text-[12px] tw:py-2 tw:px-4 tw:cursor-pointer tw:hover:underline tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent tw:hover:enabled:not-[.seg2_&]:bg-hover tw:hover:enabled:not-[.seg2_&]:border-border-3" @click="planPeriod">Указать период…</button>
      </template>
    </div>

    <div class="inputrow tw:flex tw:items-start tw:gap-10">
      <QuickField
        :ref="els.labelInput"
        v-model="label"
        class="cutq tw:flex-1 tw:min-w-0"
        :day="today"
        placeholder="30м, 14:00-15:00, ABC-123, #вид · @ задача"
        @submit="cut()"
        @kind="(k) => (kind = k)"
        @task="(t) => !cutTasks.some((x) => x.key === t.key) && (cutTasks = [...cutTasks, t])"
        @parsed="(p) => (cutParsed = p)"
      />
      <DictateButton class="tw:[.seg2_&]:not-[&.on]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:not-[&.compact]:py-3 tw:[.seg2_&]:not-[&.compact]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-[&.on]:bg-transparent tw:[.seg2_&]:[&.on]:bg-accent tw:[&&]:[.seg2_&]:[&.on]:text-on-accent" @recorded="(r) => cut(r)" />
      <TaskPicker v-model="cutTasks" compact />
      <OffsetField compact class="dialoff tw:flex-none tw:[&&&]:h-44 tw:[&&]:rounded-[4px] tw:[.abar_&]:block" :max="240" :model-value="dial" @update:model-value="onDial" @commit="onDial(dial)" />
    </div>

    <div class="actions tw:flex tw:gap-8 tw:items-stretch">
      <button class="apply tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent tw:flex-none tw:flex tw:items-center tw:justify-center tw:w-46 tw:rounded-[4px] tw:bg-up tw:border tw:border-up tw:text-text-hi tw:[&&]:hover:enabled:bg-up tw:hover:enabled:not-[.seg2_&]:border-border-3" title="Применить (Enter)" :disabled="saving" @click="cut()"><Icon name="check" :size="20" :stroke="2.6" /></button>
      <div class="kseg tw:flex-1 tw:min-w-0 tw:flex tw:border tw:border-white/12 tw:rounded-[4px] tw:overflow-hidden">
        <button class="tw:[.seg2_&]:[&.on]:not-hover:bg-accent tw:flex-[1_1_0] tw:min-w-0 tw:flex tw:flex-col tw:items-center tw:gap-3 tw:pt-6 tw:pr-4 tw:pb-5 tw:pl-4 tw:border-0 tw:rounded-none tw:[&&]:border-l tw:[&&]:border-l-white/8 tw:bg-white/2 tw:text-[11px] tw:text-text-2 tw:[&&]:first:border-l-0 tw:hover:bg-white/7 tw:[&.on]:text-text-hi"
          v-for="k in shownKinds"
          :key="k.id"
          :class="{ on: kind === k.id }"
          :style="kind === k.id ? { background: k.color } : {}"
          :title="k.label"
          @click="pickKind(k.id)"
        >
          <Icon :name="k.icon" :size="14" />
          <span class="tw:max-w-full tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ k.label }}</span>
        </button>
      </div>
    </div>

    <div class="foot tw:min-h-22 tw:text-[12px]">
      <Transition name="fade" mode="out-in">
        <span v-if="toast" :key="toast.text" class="toast tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2 tw:inline-flex tw:items-center tw:gap-5 tw:text-up-fg tw:[&.bad]:text-down-fg" :class="{ bad: !toast.ok }">
          <Icon :name="toast.ok ? 'check' : 'x'" :size="13" />{{ toast.text }}
        </span>
        <span v-else key="calls" class="calls tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2 tw:flex tw:gap-6">
          <button v-for="c in detectedCalls" :key="c.start" class="chip callchip tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent tw:border-(--call-mark) tw:text-(--call-mark-fg) tw:hover:enabled:not-[.seg2_&]:border-border-3" @click="useCall(c)">
            <Icon name="phone" :size="12" />{{ c.app }} {{ formatHM(c.start) }}–{{ formatHM(c.end) }}
          </button>
        </span>
      </Transition>
    </div>
  </div>
</template>
