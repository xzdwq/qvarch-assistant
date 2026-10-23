<script setup lang="ts">
import { computed, ref } from 'vue'
import { boardPathOf } from './model'
import { imageEmbed } from '@shared/vault'
import { doc, files, openFile, tree } from '@renderer/lib/notebook'
import BoardView from '@renderer/components/BoardView.vue'
import Icon from '@renderer/components/Icon.vue'

/**
 * A board shown in a note: only to look at, always as it is now (drawn on elsewhere — it changes here too).
 * «Снимок» puts a PNG of it in its place — a picture of the note, no longer tied to the board.
 */
const props = defineProps<{ src: string; onChange?: (src: string) => void }>()
const path = computed(() => boardPathOf(props.src))
const d = computed(() => (path.value ? doc(path.value) : undefined))
const exists = computed(() => {
  void files.value
  const find = (ns: typeof tree.value): boolean => ns.some((n) => n.path === path.value || (!!n.children && find(n.children)))
  return find(tree.value)
})
const name = computed(() => (path.value.split('/').pop() ?? '').replace(/\.qboard$/i, ''))
const view = ref<InstanceType<typeof BoardView>>()
const busy = ref(false)
const error = ref('')
async function snapshot(): Promise<void> {
  if (!view.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const png = await view.value.pngBytes()
    if (!png) return void (error.value = 'Доска пуста — снимать нечего')
    const rel = await window.qa.vaultSaveImage(png)
    props.onChange?.(imageEmbed(rel))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="bb tw:flex tw:flex-col tw:gap-8 tw:pt-8 tw:pr-10 tw:pb-10 tw:pl-10 tw:border tw:border-border tw:rounded-[8px] tw:bg-panel">
    <div class="bb-h tw:flex tw:items-center tw:gap-10 tw:min-w-0 tw:text-[12.5px]">
      <span class="bb-k tw:inline-flex tw:items-center tw:gap-6 tw:text-muted"><Icon name="presentation" :size="14" />Доска</span>
      <b class="tw:overflow-hidden tw:text-text-hi tw:text-ellipsis tw:whitespace-nowrap">{{ name || 'не выбрана' }}</b>
      <span class="bb-live tw:text-up-fg tw:text-[11px]" title="Показывает доску как она есть сейчас">● вживую</span>
      <span v-if="error" class="bb-err tw:text-down-fg">{{ error }}</span>
      <span class="grow tw:flex-1"></span>
      <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-9 tw:text-[12px]" v-if="exists" title="Открыть доску для рисования" @mousedown.prevent @click="openFile(path)"><Icon name="external" :size="13" />Открыть</button>
      <button v-if="exists" class="primary tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-9 tw:text-[12px]" :disabled="busy" title="Сохранить картинку доски сейчас — она встанет на это место, связь с доской разорвётся" @mousedown.prevent @click="snapshot"><Icon name="image" :size="13" />{{ busy ? 'Снимаю…' : 'Снимок' }}</button>
    </div>
    <div v-if="!exists" class="bb-miss tw:p-16 tw:text-muted tw:text-[13px]">Доска «{{ name || path }}» не найдена — её удалили или переименовали.</div>
    <div v-else-if="d?.loaded" class="bb-view tw:h-380 tw:overflow-hidden tw:rounded-[6px]">
      <BoardView ref="view" :path="path" :text="d.text" preview />
    </div>
    <div v-else class="bb-miss tw:p-16 tw:text-muted tw:text-[13px]">Загружаю…</div>
  </div>
</template>

<style scoped src="./BlockBoard.css"></style>
