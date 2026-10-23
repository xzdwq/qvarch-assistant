<script setup lang="ts">
import { computed } from 'vue'
import { formatDuration, formatHM } from '@shared/timeline'
import { orbMood, pillItemKey } from '@shared/tracker/islandPill'
import ActivityWave from '../../components/ActivityWave.vue'
import Icon from '../../components/Icon.vue'
import ThinkingOrb from '../../components/ThinkingOrb.vue'
import { cssHex } from '../../lib/cssColor'
import { entryIcon, kindColor, kindIcon, kindLabel } from '../../lib/palette'
import { useIsland } from '../islandState'
import QuickNotePanel from './QuickNotePanel.vue'

/**
 * The collapsed pill (or the slim pill stuck to a screen edge): status, call app, typing combo, activity, the
 * marker, date and productive time; the day's chips and totals; the orb — a click opens the quick note.
 */
const { els, island, day, typingCombo, pick, expand, quick, layout } = useIsland()
const { ui, voiceBusy } = island
const { live, now, schedule, status, pillInfo, chips: pillItems, chipLabel: chipText, kindTotals, taskTotals } = day
const { workMs, dayOff, productive, productivePct, split, pctTitle, dateText, nextMeeting, nextIn, noteTitle, noteIcon } = day
const { combo, typing, heat, comboOn } = typingCombo
const { marker } = pick
const { setExpanded } = expand
const { noteOpen, recording, toggleNote } = quick
const { dock, pillH } = layout

/** The orb mirrors what is going on (each state is a distinct animation, tinted). */
const mascot = computed(() => {
  const w = schedule.value.work
  return orbMood({
    recording: !!recording.value,
    transcribing: voiceBusy.value,
    noteOpen: noteOpen.value,
    inCall: live.value.inCall,
    dayFilled: !!workMs.value && split.value.within >= workMs.value,
    offHours: dayOff.value || (!!w && now.value >= w[1]),
  })
})
</script>

<template>
  <div class="pill tw:group/pill tw:[&.docked]:not-group-[.up]/stage:inset-0 tw:[&.docked]:gap-6 tw:[&.docked]:pt-0 tw:[&.docked]:pr-12 tw:[&.docked]:pb-0 tw:[&.docked]:pl-4 tw:group-[.dock-left]/stage:[&.docked]:not-group-[.dock-right]/stage:[writing-mode:sideways-lr] tw:group-[.dock-left]/stage:[&.docked]:not-group-[.dock-right]/stage:pt-4 tw:group-[.dock-left]/stage:[&.docked]:not-group-[.dock-right]/stage:pr-0 tw:group-[.dock-left]/stage:[&.docked]:not-group-[.dock-right]/stage:pb-12 tw:group-[.dock-left]/stage:[&.docked]:not-group-[.dock-right]/stage:pl-0 tw:group-[.dock-right]/stage:[&.docked]:[writing-mode:vertical-rl] tw:group-[.dock-right]/stage:[&.docked]:pt-4 tw:group-[.dock-right]/stage:[&.docked]:pr-0 tw:group-[.dock-right]/stage:[&.docked]:pb-12 tw:group-[.dock-right]/stage:[&.docked]:pl-0 tw:absolute tw:left-0 tw:right-0 tw:top-0 tw:h-70 tw:flex tw:items-center tw:gap-8 tw:pt-0 tw:pr-10 tw:pb-0 tw:pl-7 tw:cursor-pointer tw:group-[.up]/stage:top-auto tw:group-[.up]/stage:bottom-0" :class="{ docked: !!dock && !noteOpen }" :style="{ height: dock && !noteOpen ? '100%' : `${pillH}px` }" @click="!noteOpen && setExpanded(true)">
    <span :ref="els.pillHandle" class="handle drag tw:group-[.docked]/pill:w-26 tw:group-[.docked]/pill:h-26 tw:[-webkit-app-region:drag] tw:cursor-move tw:flex-none tw:flex tw:items-center tw:justify-center tw:w-32 tw:h-32 tw:rounded-[4px] tw:text-dim tw:bg-white/4 tw:[.abar_&]:block tw:[.abar_&]:not-group-[.docked]/pill:h-full tw:[.abar_&]:rounded-r2" title="Переместить">
      <Icon name="grip" :size="16" />
    </span>
    <div class="pinfo tw:group-[.docked]/pill:flex tw:group-[.docked]/pill:items-center tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-4">
      <div :ref="els.plineEl" class="pline tw:group-[.docked]/pill:flex-1 tw:flex tw:items-center tw:gap-6 tw:text-[12px] tw:leading-[14px] tw:whitespace-nowrap tw:overflow-hidden">
        <span class="dot tw:group-[.docked]/pill:[&.pwave]:not-[&.handle]:w-64 tw:group-[.docked]/pill:[&.pwave]:not-[&.handle]:h-18 tw:group-[.docked]/pill:[&.pwave]:flex-none tw:group-[.dock-left]/stage:group-[.docked]/pill:[&.pwave]:not-group-[.dock-right]/stage:[writing-mode:horizontal-tb] tw:group-[.dock-right]/stage:group-[.docked]/pill:[&.pwave]:[writing-mode:horizontal-tb] tw:group-[.dock-left]/stage:group-[.docked]/pill:[&.pwave]:not-group-[.dock-right]/stage:w-64 tw:[&&]:group-[.dock-right]/stage:group-[.docked]/pill:[&.pwave]:w-64 tw:group-[.dock-left]/stage:group-[.docked]/pill:[&.pwave]:not-group-[.dock-right]/stage:h-18 tw:[&&]:group-[.dock-right]/stage:group-[.docked]/pill:[&.pwave]:h-18 tw:group-[.dock-left]/stage:group-[.docked]/pill:[&.pwave]:not-group-[.dock-right]/stage:my-23 tw:group-[.dock-left]/stage:group-[.docked]/pill:[&.pwave]:not-group-[.dock-right]/stage:-mx-23 tw:group-[.dock-right]/stage:group-[.docked]/pill:[&.pwave]:my-23 tw:group-[.dock-right]/stage:group-[.docked]/pill:[&.pwave]:-mx-23 tw:group-[.dock-right]/stage:group-[.docked]/pill:[&.pwave]:not-group-[.dock-left]/stage:[transform:rotate(90deg)] tw:group-[.dock-left]/stage:group-[.docked]/pill:[&.pwave]:[transform:rotate(-90deg)] tw:group-[.docked]/pill:[&.handle]:w-26 tw:[&&]:group-[.docked]/pill:[&.handle]:h-26 tw:[&.handle]:cursor-move tw:[&.handle]:not-[.abar_&]:flex tw:[&.handle]:items-center tw:[&.handle]:justify-center tw:[&.handle]:text-dim tw:flex-none tw:w-8 tw:h-8 tw:rounded-[50%] tw:[background:var(--ok)] tw:[transition:background_0.3s] tw:[&.call]:bg-(--call-mark) tw:[&.call]:animate-[Island-pulse_1.6s_ease-in-out_infinite] tw:[&.pfill]:not-[&.pwave]:flex-1 tw:[&.pwave]:flex-[1_1_0] tw:[&.pwave]:w-0 tw:[&.pwave]:min-w-20 tw:[&.pwave]:not-[.abar_&]:h-14 tw:[&.uncut]:not-[.abar_&]:rounded-r2 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2 tw:[&.empty]:m-6 tw:[&.empty]:text-[12px]" :class="status.cls"></span>
        <span class="pstatus tw:group-[.docked]/pill:hidden tw:group-[.docked]/pill:[&.pwave]:not-[&.handle]:w-64 tw:group-[.docked]/pill:[&.pwave]:not-[&.handle]:h-18 tw:group-[.docked]/pill:[&.pwave]:flex-none tw:group-[.dock-left]/stage:group-[.docked]/pill:[&.pwave]:not-group-[.dock-right]/stage:[writing-mode:horizontal-tb] tw:group-[.dock-right]/stage:group-[.docked]/pill:[&.pwave]:[writing-mode:horizontal-tb] tw:group-[.dock-left]/stage:group-[.docked]/pill:[&.pwave]:not-group-[.dock-right]/stage:w-64 tw:[&&]:group-[.dock-right]/stage:group-[.docked]/pill:[&.pwave]:w-64 tw:[&&]:group-[.dock-left]/stage:group-[.docked]/pill:[&.pwave]:not-group-[.dock-right]/stage:h-18 tw:[&&&]:group-[.dock-right]/stage:group-[.docked]/pill:[&.pwave]:h-18 tw:group-[.dock-left]/stage:group-[.docked]/pill:[&.pwave]:not-group-[.dock-right]/stage:my-23 tw:group-[.dock-left]/stage:group-[.docked]/pill:[&.pwave]:not-group-[.dock-right]/stage:-mx-23 tw:group-[.dock-right]/stage:group-[.docked]/pill:[&.pwave]:my-23 tw:group-[.dock-right]/stage:group-[.docked]/pill:[&.pwave]:-mx-23 tw:group-[.dock-right]/stage:group-[.docked]/pill:[&.pwave]:not-group-[.dock-left]/stage:[transform:rotate(90deg)] tw:group-[.dock-left]/stage:group-[.docked]/pill:[&.pwave]:[transform:rotate(-90deg)] tw:[&&]:group-[.docked]/pill:[&.handle]:w-26 tw:[&&&]:group-[.docked]/pill:[&.handle]:h-26 tw:[&.handle]:cursor-move tw:[&.handle]:not-[&.pfill]:not-[&.pwave]:flex-none tw:[&.handle]:not-group-[.docked]/pill:not-[.abar_&]:flex tw:[&.handle]:items-center tw:[&.handle]:justify-center tw:[&.handle]:not-[&.pwave]:w-32 tw:[&.handle]:not-[&.pwave]:not-[.abar_&]:h-32 tw:[&.handle]:not-[&.uncut]:not-[.abar_&]:rounded-[4px] tw:[&.handle]:not-[&.work]:not-[&.call]:text-dim tw:[&.handle]:bg-white/4 tw:font-data tw:text-[11px] tw:font-bold tw:tracking-[0.04em] tw:uppercase tw:[&.work]:not-[&.call]:text-up tw:[&.call]:text-down-fg tw:[&.pfill]:not-[&.pwave]:flex-1 tw:[&.pwave]:flex-[1_1_0] tw:[&.pwave]:w-0 tw:[&.pwave]:min-w-20 tw:[&.pwave]:not-[.abar_&]:h-14 tw:[&.uncut]:not-[.abar_&]:rounded-r2 tw:[.abar_&]:not-group-[.docked]/pill:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2 tw:[&.empty]:m-6 tw:[&.empty]:text-[12px]" :class="status.cls">{{ status.text }}</span>
        <span v-if="pillInfo && ui.pill.app" class="papp tw:group-[.docked]/pill:hidden tw:flex-none tw:max-w-150 tw:text-text-2 tw:overflow-hidden tw:text-ellipsis tw:[.abar_&]:not-group-[.docked]/pill:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ pillInfo }}</span>
        <span
          v-if="comboOn && ui.pill.combo"
          class="pcombo tw:group-[.docked]/pill:hidden tw:flex-none tw:inline-flex tw:items-center tw:gap-4 tw:min-w-50 tw:text-muted tw:text-[11px] tw:tabular-nums tw:font-data tw:[&.live]:text-text tw:[.abar_&]:not-group-[.docked]/pill:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"
          :class="{ live: typing }"
          :title="`Комбо — нажатия клавиш с паузами меньше 3 с. Лучшее за день: ${combo.best}${combo.bestAt ? ` (в ${formatHM(combo.bestAt)})` : ''}`"
        >
          <Icon name="keyboard" :size="12" />
          <span v-if="typing" class="cwrap tw:inline-block tw:origin-[0_60%] tw:[transition:transform_0.15s_ease-out] tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :style="{ transform: `scale(${1 + heat * 0.15})` }">
            <span
              :key="combo.current"
              class="cnum tw:inline-block tw:min-w-22 tw:font-extrabold tw:animate-[Island-comboShake_0.22s_ease-out] tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"
              :style="{ '--amp': `${0.2 + heat * 0.7}px`, color: `color-mix(in srgb, var(--combo-hot) ${Math.round(heat * 100)}%, var(--combo-cold))` }"
              >{{ combo.current }}</span
            >
          </span>
          <span v-else class="cbest tw:font-bold tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ combo.best }}</span>
        </span>
        <ActivityWave v-if="dock && !noteOpen ? ui.dock.wave : ui.pill.wave" class="pwave tw:[&&]:group-[.docked]/pill:w-64 tw:[&&]:group-[.docked]/pill:h-18 tw:group-[.docked]/pill:flex-none tw:group-[.dock-left]/stage:group-[.docked]/pill:not-group-[.dock-right]/stage:[writing-mode:horizontal-tb] tw:group-[.dock-right]/stage:group-[.docked]/pill:[writing-mode:horizontal-tb] tw:group-[.dock-left]/stage:group-[.docked]/pill:not-group-[.dock-right]/stage:w-64 tw:[&&]:group-[.dock-right]/stage:group-[.docked]/pill:w-64 tw:group-[.dock-left]/stage:group-[.docked]/pill:not-group-[.dock-right]/stage:h-18 tw:[&&]:group-[.dock-right]/stage:group-[.docked]/pill:h-18 tw:group-[.dock-left]/stage:group-[.docked]/pill:not-group-[.dock-right]/stage:my-23 tw:group-[.dock-left]/stage:group-[.docked]/pill:not-group-[.dock-right]/stage:-mx-23 tw:group-[.dock-right]/stage:group-[.docked]/pill:my-23 tw:group-[.dock-right]/stage:group-[.docked]/pill:-mx-23 tw:group-[.dock-right]/stage:group-[.docked]/pill:not-group-[.dock-left]/stage:[transform:rotate(90deg)] tw:group-[.dock-left]/stage:group-[.docked]/pill:[transform:rotate(-90deg)] tw:flex-[1_1_0] tw:[&&]:w-0 tw:min-w-20 tw:[&&]:h-14" title="Активность" />
        <span v-else class="pfill tw:flex-1 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"></span>
        <span class="pend tw:ml-0 tw:flex-none tw:inline-flex tw:items-center tw:gap-6 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">
          <span v-if="marker" class="pmarker tw:group-[.docked]/pill:hidden tw:inline-flex tw:items-center tw:gap-3 tw:py-0 tw:px-6 tw:rounded-r2 tw:bg-accent/18 tw:text-accent-fg tw:text-[11px] tw:[.abar_&]:not-group-[.docked]/pill:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">
            <Icon name="scissors" :size="11" />{{ formatHM(marker.start) }}–{{ marker.end ? formatHM(marker.end) : 'сейчас' }}
          </span>
          <span v-if="ui.pill.date" class="pday tw:group-[.docked]/pill:hidden tw:ml-6 tw:text-muted tw:text-[11px] tw:[.abar_&]:not-group-[.docked]/pill:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ dateText }}</span>
          <span v-if="dock && !noteOpen && ui.dock.next && nextMeeting" class="pnext tw:inline-flex tw:items-center tw:gap-4 tw:text-info-fg tw:text-[11.5px] tw:font-semibold tw:whitespace-nowrap tw:tabular-nums tw:font-data tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :title="`До встречи «${nextMeeting.label}» в ${formatHM(nextMeeting.start)}`"><Icon name="calendar" :size="11" />{{ nextIn }}</span>
          <b
            v-if="!dock || noteOpen || ui.dock.time"
            class="ptime tw:text-[11px] tw:text-up-fg tw:tabular-nums tw:font-data"
            :title="`Продуктивно ${formatDuration(productive)}${workMs ? ` (${productivePct}% рабочего дня)` : ''}: в рабочие часы ${formatDuration(split.within)}, сверх ${formatDuration(split.over)}.`"
            >{{ formatDuration(productive) }}</b
          >
        </span>
      </div>
      <div v-if="ui.pill.chips" :ref="els.chipsEl" class="chips tw:group-[.docked]/pill:hidden tw:flex tw:gap-4 tw:h-20 tw:w-max tw:max-w-full tw:overflow-hidden">
        <template v-for="it in pillItems" :key="pillItemKey(it)">
          <span
            v-if="it.type === 'entry'"
            class="pchip tw:flex-none tw:py-0 tw:px-7 tw:whitespace-nowrap tw:h-20 tw:inline-flex tw:items-center tw:justify-center tw:gap-4 tw:rounded-r2 tw:text-text-hi tw:text-[10px] tw:font-bold tw:tabular-nums tw:font-data tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"
            :style="{ background: kindColor(it.e.kind) }"
            :title="`${kindLabel(it.e.kind)} · ${it.e.label} · ${formatHM(it.e.start)}–${formatHM(it.e.end)} · ${formatDuration(it.e.end - it.e.start)}`"
          >
            <Icon :name="entryIcon(it.e)" :size="11" :stroke="2.4" />
            <span v-if="it.e.task" class="ckey tw:font-extrabold tw:opacity-95 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ it.e.task.key }}</span>
            <span class="tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ chipText(it.e.end - it.e.start) }}</span>
          </span>
          <span
            v-else-if="it.type === 'plan'"
            class="pchip pplan tw:bg-transparent tw:border tw:border-dashed tw:border-(--c) tw:text-(--c) tw:flex-none tw:py-0 tw:px-7 tw:whitespace-nowrap tw:h-20 tw:inline-flex tw:items-center tw:justify-center tw:gap-4 tw:rounded-r2 tw:text-[10px] tw:font-bold tw:tabular-nums tw:font-data tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"
            :style="{ '--c': kindColor(it.p.kind) }"
            :title="`План: ${it.p.task ? it.p.task.key + ' ' : ''}${it.p.label} · ${formatHM(it.p.start)}–${formatHM(it.p.end)}`"
          ><Icon :name="entryIcon(it.p)" :size="11" :stroke="2.4" />{{ chipText(it.p.end - it.p.start) }}</span>
          <span v-else-if="it.type === 'note'" class="pchip pnotechip tw:flex-none tw:whitespace-nowrap tw:h-20 tw:inline-flex tw:items-center tw:justify-center tw:gap-4 tw:rounded-r2 tw:text-[10px] tw:font-bold tw:tabular-nums tw:font-data tw:py-0 tw:px-5 tw:bg-warn tw:text-bg tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :title="noteTitle(it.n)"><Icon :name="noteIcon(it.n)" :size="11" :stroke="2.4" /></span>
          <span v-else class="pchip tw:flex-none tw:py-0 tw:px-7 tw:whitespace-nowrap tw:h-20 tw:inline-flex tw:items-center tw:justify-center tw:gap-4 tw:rounded-r2 tw:text-text-hi tw:text-[10px] tw:font-bold tw:tabular-nums tw:font-data tw:[&.gap]:not-[&.live]:text-text-2 tw:[&.gap]:not-[&.live]:[background:repeating-linear-gradient(135deg,rgba(127,139,157,0.35)_0_5px,rgba(127,139,157,0.12)_5px_10px)] tw:[&.live]:text-text tw:[&.live]:[background:repeating-linear-gradient(135deg,rgba(127,139,157,0.45)_0_5px,rgba(127,139,157,0.15)_5px_10px)] tw:[&&]:[&.live]:bg-size-[14px_14px] tw:[&.live]:animate-[Island-flow_1.4s_linear_infinite] tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :class="it.live ? 'live' : 'gap'" :title="`Не размечено ${formatHM(it.t)}–${it.live ? 'сейчас' : formatHM(it.t + it.ms)}`"><span v-if="it.live" class="pulse tw:w-6 tw:h-6 tw:rounded-[50%] tw:bg-warn tw:animate-[Island-blink_1.2s_ease-in-out_infinite] tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"></span>{{ formatDuration(it.ms) }}</span>
        </template>
        <span v-if="!pillItems.length" class="muted pempty tw:text-[11px] tw:leading-[20px] tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">записей пока нет</span>
      </div>
      <div v-if="ui.pill.stats" :ref="els.statsEl" class="pstats tw:group-[.docked]/pill:hidden tw:flex tw:items-center tw:gap-10 tw:w-max tw:max-w-full tw:h-13 tw:overflow-hidden tw:text-[10px] tw:leading-[13px] tw:text-muted tw:tabular-nums tw:font-data tw:whitespace-nowrap">
        <span v-for="[k, ms] in kindTotals" :key="k" class="st tw:flex-none tw:inline-flex tw:items-center tw:gap-3 tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :title="`${kindLabel(k)} — всего за день`">
          <Icon :name="kindIcon(k)" :size="11" :stroke="2.2" :style="{ color: kindColor(k) }" />{{ formatDuration(ms) }}
        </span>
        <span v-for="[key, t] in taskTotals" :key="key" class="st jt tw:flex-none tw:inline-flex tw:items-center tw:gap-3 tw:text-info-fg tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :title="`${key} — ${t.summary}: всего за день`">
          <Icon name="jira" :size="11" />{{ key }} {{ formatDuration(t.ms) }}
        </span>
        <span v-if="workMs" class="st pct tw:flex-none tw:inline-flex tw:items-center tw:gap-3 tw:text-up-fg tw:font-bold tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :title="pctTitle">{{ productivePct }}% полезного</span>
      </div>
    </div>
    <button v-if="!dock || noteOpen || ui.dock.orb" :ref="els.orbEl" class="orb-btn tw:group-[.docked]/pill:flex-none tw:group-[.docked]/pill:w-26 tw:group-[.docked]/pill:h-26 tw:group-[.docked]/pill:m-0 tw:group-[.docked]/pill:p-0 tw:relative tw:flex-none tw:flex tw:items-center tw:justify-center tw:w-44 tw:h-44 tw:p-0 tw:border-0 tw:rounded-[50%] tw:bg-transparent tw:cursor-pointer tw:[transition:background_0.2s] tw:hover:not-[&.on]:bg-white/6 tw:[&.on]:bg-white/6 tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:not-group-[.docked]/pill:py-3 tw:[.seg2_&]:not-group-[.docked]/pill:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-hover:not-[&.on]:bg-transparent tw:[.seg2_&]:[&.on]:bg-accent tw:[.seg2_&]:[&.on]:text-on-accent tw:hover:enabled:not-[.seg2_&]:border-border-3 tw:[&.rec]:after:content-[''] tw:[&.rec]:after:absolute tw:[&.rec]:after:top-6 tw:[&.rec]:after:right-6 tw:[&.rec]:after:w-9 tw:[&.rec]:after:h-9 tw:[&.rec]:after:rounded-[50%] tw:[&.rec]:after:bg-down tw:[&.rec]:after:[box-shadow:0_0_0_2px_var(--bg)] tw:[&.rec]:after:animate-[Island-recpulse_1.2s_ease-in-out_infinite]" :class="{ on: noteOpen, rec: !!recording }" :title="recording ? 'Идёт запись — клик: открыть' : mascot.title" @click.stop="toggleNote">
      <ThinkingOrb :state="mascot.state" :size="dock && !noteOpen ? 20 : 32" :px="dock && !noteOpen ? 24 : 40" :speed="mascot.speed" :tint="cssHex(mascot.tint)" />
    </button>
    <QuickNotePanel />
  </div>
</template>
