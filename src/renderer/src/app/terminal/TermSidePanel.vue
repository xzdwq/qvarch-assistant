<script setup lang="ts">
/** The terminal's side panel: presets / variables / reactions (one list at a time), the profile switch, the guide. */
import type { Component } from 'vue'
import Icon from '../../components/Icon.vue'
import TermPresetList from './TermPresetList.vue'
import TermSessionList from './TermSessionList.vue'
import TermVarList from './TermVarList.vue'
import TermWatchList from './TermWatchList.vue'
import { useTermView } from './termViewContext'
import { SIDE_TAB_IDS, type SideTab } from './useTermViewPrefs'

const { prefs, alerts, config, runner, helpOpen } = useTermView()
const { sideTab, sideHidden, dragSide } = prefs
const { cfg, setProfile } = config
const { runError } = runner
/** Each side tab's icon, its name (the tooltip) and the list it shows. */
const SIDE_TABS: Record<SideTab, { label: string; icon: string; list: Component }> = {
  ssh: { label: 'Сессии SSH', icon: 'monitor', list: TermSessionList },
  presets: { label: 'Пресеты — команды в один клик', icon: 'zap', list: TermPresetList },
  vars: { label: 'Переменные для пресетов', icon: 'braces', list: TermVarList },
  watch: { label: 'Реакции на слова в выводе', icon: 'bell', list: TermWatchList },
}
</script>

<template>
    <aside class="ps tw:relative tw:flex tw:flex-col tw:min-h-0 tw:border-r tw:border-r-border tw:bg-panel">
      <div class="stabs tw:flex tw:flex-none tw:h-38 tw:border-b tw:border-b-border">
        <button v-for="t in SIDE_TAB_IDS" :key="t" class="tw:relative tw:flex-1 tw:min-w-0 tw:inline-flex tw:items-center tw:justify-center tw:py-0 tw:px-4 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:hover:not-[&.on]:text-text tw:[&.on]:text-text-hi tw:[&.on]:[box-shadow:var(--shadow-underline)]" :class="{ on: sideTab === t }" :title="SIDE_TABS[t].label" :aria-label="SIDE_TABS[t].label" @click="sideTab = t"><Icon :name="SIDE_TABS[t].icon" :size="14" /><i v-if="t === 'watch' && alerts.length" class="sdot tw:absolute tw:top-9 tw:right-[calc(50%-12px)] tw:w-6 tw:h-6 tw:rounded-[50%] tw:animate-[Shared-blink-25_0.36s_steps(2)_infinite]" :style="{ background: alerts[0].color }"></i></button>
        <button class="shide tw:flex-none tw:w-34 tw:relative tw:min-w-0 tw:py-0 tw:px-4 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis tw:hover:text-text" title="Скрыть панель" @click="sideHidden = true"><Icon name="sidebar" :size="14" /></button>
      </div>

      <component :is="SIDE_TABS[sideTab].list" />

      <p v-if="runError" class="perr tw:my-6 tw:mx-10 tw:text-down-fg tw:text-[12px] tw:wrap-anywhere">{{ runError }}</p>
      <label class="prof tw:flex tw:items-center tw:gap-7 tw:mt-6 tw:mr-10 tw:mb-0 tw:ml-10 tw:text-text-2 tw:text-[12px]" title="Профиль PowerShell (для новых оболочек)"><input type="checkbox" :checked="cfg.profile" @change="setProfile(($event.target as HTMLInputElement).checked)" />Загружать профиль PowerShell</label>
      <button class="howto tw:flex tw:items-center tw:gap-8 tw:m-8 tw:py-8 tw:px-10 tw:border tw:border-dashed tw:border-border-3 tw:rounded-r3 tw:bg-panel-2 tw:text-text-2 tw:text-[12px] tw:text-left tw:hover:border-accent tw:hover:text-accent-fg tw:hover:enabled:bg-hover" @click="helpOpen = true"><Icon name="book" :size="14" />Инструкция</button>
      <span class="sgrip tw:absolute tw:top-0 tw:-right-3 tw:bottom-0 tw:z-3 tw:w-6 tw:cursor-col-resize tw:hover:bg-accent-line" @pointerdown="dragSide"></span>
    </aside>
</template>
