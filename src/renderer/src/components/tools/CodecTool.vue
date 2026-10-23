<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import CodecBase64 from './codec/CodecBase64.vue'
import CodecHash from './codec/CodecHash.vue'
import CodecJwt from './codec/CodecJwt.vue'
import CodecUuid from './codec/CodecUuid.vue'
import { useCopyNote } from './codec/useCopyNote'

/**
 * Кодировки: four tabs — JWT, UUID, Base64, Хэш (each in ./codec). A tab keeps what was typed in it while
 * another one is open (kept alive); what was copied is noted in the tab bar.
 */
/** The tabs in order: each with its panel. */
const TABS = [
  { id: 'jwt', label: 'JWT', view: CodecJwt },
  { id: 'uuid', label: 'UUID', view: CodecUuid },
  { id: 'b64', label: 'Base64', view: CodecBase64 },
  { id: 'hash', label: 'Хэш', view: CodecHash },
] as const satisfies ReadonlyArray<{ id: string; label: string; view: Component }>
type Tab = (typeof TABS)[number]['id']
const TAB_KEY = 'qa.tools.codec'
const savedTab = localStorage.getItem(TAB_KEY)
const tab = ref<Tab>(TABS.find((t) => t.id === savedTab)?.id ?? 'jwt')
const current = computed(() => TABS.find((t) => t.id === tab.value) ?? TABS[0])
watch(tab, (v) => {
  try {
    localStorage.setItem(TAB_KEY, v)
  } catch {
    // fine
  }
})
const clip = useCopyNote()
const copied = clip.note
</script>

<template>
  <div class="ct tw:flex tw:flex-col tw:h-full tw:min-h-0">
    <div class="tabs tw:flex-none tw:flex tw:items-center tw:h-38 tw:py-0 tw:px-14 tw:border-b tw:border-b-border">
      <button class="tw:h-38 tw:py-0 tw:px-14 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:[&.on]:text-text-hi tw:[&.on]:[box-shadow:var(--shadow-underline)]" v-for="t in TABS" :key="t.id" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
      <span class="grow tw:flex-1"></span>
      <span v-if="copied" class="copied tw:text-up-fg tw:text-[12px]">{{ copied }}</span>
    </div>
    <KeepAlive>
      <component :is="current.view" :clip="clip" />
    </KeepAlive>
  </div>
</template>
