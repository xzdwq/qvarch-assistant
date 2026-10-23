<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { seriesQuestion } from '../lib/seriesAsk'
import Icon from './Icon.vue'

/** The "only this one / the whole series" question of a repeated block. */
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && seriesQuestion.value) seriesQuestion.value.resolve(null)
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="seriesQuestion" class="sa-back tw:fixed tw:inset-0 tw:z-2000 tw:flex tw:items-center tw:justify-center tw:bg-bg/45" @pointerdown.self="seriesQuestion.resolve(null)">
      <div class="sa tw:w-380 tw:max-w-[calc(100vw-32px)] tw:py-14 tw:px-16 tw:rounded-r3 tw:border tw:border-white/10 tw:bg-panel-2 tw:[box-shadow:var(--shadow-dialog)] tw:text-text tw:text-[13px]">
        <div class="sa-h tw:flex tw:items-center tw:gap-8 tw:font-semibold tw:text-accent-fg"><Icon name="repeat" :size="15" />Повторяющееся событие</div>
        <p class="tw:mt-10 tw:mr-0 tw:mb-14 tw:ml-0 tw:text-text-2 tw:leading-[1.45]">{{ seriesQuestion.action === 'delete' ? 'Удалить только это событие или все события серии?' : 'Применить изменения только к этому событию или ко всем событиям серии?' }}</p>
        <div class="sa-b tw:flex tw:items-center tw:gap-8">
          <button class="primary tw:py-6 tw:px-12 tw:rounded-[4px] tw:text-[12.5px]" @click="seriesQuestion.resolve('one')">Только это</button>
          <button class="tw:py-6 tw:px-12 tw:rounded-[4px] tw:text-[12.5px] tw:[&.danger]:text-down-fg" :class="{ danger: seriesQuestion.action === 'delete' }" @click="seriesQuestion.resolve('all')">Все в серии</button>
          <span class="sp tw:flex-1"></span>
          <button class="ghost tw:py-6 tw:px-12 tw:rounded-[4px] tw:text-[12.5px] tw:bg-transparent tw:border-transparent tw:text-muted" @click="seriesQuestion.resolve(null)">Отмена</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
