<script setup lang="ts">
/**
 * Settings: sections in a sidebar (tabs on top in a narrow window); each section is a component of its own from the
 * registry. The form they share is kept with «Сохранить» / Ctrl+S; some sections apply their changes at once.
 */
import type { PublicSettings } from '@shared/types'
import Icon from '../components/Icon.vue'
import { provideSettingsContext } from './settings/settingsContext'
import { appliesAtOnce, SETTINGS_CATEGORIES as CATS } from './settings/settingsCategories'
import { SETTINGS_PANELS } from './settings/settingsPanels'

const props = defineProps<{ settings: PublicSettings }>()
const emit = defineEmits<{ changed: [s: PublicSettings] }>()
const { cat, save, saved, saveError } = provideSettingsContext(props.settings, (s) => emit('changed', s))
</script>

<template>
  <div class="settings tw:grid tw:grid-cols-[190px_minmax(0,1fr)] tw:gap-20 tw:pt-16 tw:pr-16 tw:pb-0 tw:pl-16 tw:min-h-full tw:box-border tw:items-start tw:[&&]:max-[760px]:grid-cols-[minmax(0,1fr)] tw:[&&]:max-[760px]:gap-12" @keydown.ctrl.s.prevent="save">
    <nav class="side tw:sticky tw:top-16 tw:flex tw:flex-col tw:gap-2 tw:[&&]:max-[760px]:static tw:[&&]:max-[760px]:flex-row tw:max-[760px]:overflow-x-auto tw:max-[760px]:pb-2" aria-label="Разделы настроек">
      <button class="tw:flex tw:items-center tw:gap-10 tw:py-7 tw:px-10 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:text-[13px] tw:text-left tw:whitespace-nowrap tw:hover:not-[&.on]:bg-hover tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/18 tw:[&.on]:text-text tw:max-[760px]:flex-none tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" v-for="c in CATS" :key="c.id" :class="{ on: cat === c.id }" @click="cat = c.id"><Icon :name="c.icon" :size="15" /><span class="tw:max-[520px]:hidden">{{ c.label }}</span></button>
    </nav>

    <div class="content tw:flex tw:flex-col tw:gap-14 tw:min-w-0">
      <!-- the panels (a heavy one is made only while open; the others stay, hidden) -->
      <template v-for="p in SETTINGS_PANELS" :key="p.id">
        <template v-if="p.mount === 'whenOpen'"><component :is="p.component" v-if="cat === p.category" v-bind="p.props" /></template>
        <component :is="p.component" v-else v-show="cat === p.category" v-bind="p.props" />
      </template>

    <!-- some sections apply at once; the rest needs "Сохранить" -->
    <div v-if="!appliesAtOnce(cat)" class="footer tw:flex tw:items-center tw:gap-12 tw:sticky tw:bottom-0 tw:py-12 tw:px-0 tw:bg-bg">
      <button class="primary tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2 tw:hover:enabled:bg-accent-hi tw:[&&]:hover:enabled:border-accent-hi" @click="save">Сохранить</button>
      <span class="muted small tw:text-[12px]">Ctrl+S</span>
      <span v-if="saveError" class="err tw:text-down-fg tw:text-[13px]">Не сохранилось: {{ saveError }}</span>
      <span v-if="saved" class="ok tw:text-up-fg tw:text-[13px]">Сохранено</span>
    </div>
    </div>
  </div>
</template>

<style scoped src="./SettingsView.css"></style>
