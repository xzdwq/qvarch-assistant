<script setup lang="ts">
import { computed, ref } from 'vue'
import { boardPathOf } from '@shared/noteBlocks'
import { imageEmbed } from '@shared/vault'
import { doc, files, openFile, tree } from '../../lib/notebook'
import BoardView from '../BoardView.vue'
import Icon from '../Icon.vue'

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
  <div class="bb">
    <div class="bb-h">
      <span class="bb-k"><Icon name="presentation" :size="14" />Доска</span>
      <b>{{ name || 'не выбрана' }}</b>
      <span class="bb-live" title="Показывает доску как она есть сейчас">● вживую</span>
      <span v-if="error" class="bb-err">{{ error }}</span>
      <span class="grow"></span>
      <button v-if="exists" title="Открыть доску для рисования" @mousedown.prevent @click="openFile(path)"><Icon name="external" :size="13" />Открыть</button>
      <button v-if="exists" class="primary" :disabled="busy" title="Сохранить картинку доски сейчас — она встанет на это место, связь с доской разорвётся" @mousedown.prevent @click="snapshot"><Icon name="image" :size="13" />{{ busy ? 'Снимаю…' : 'Снимок' }}</button>
    </div>
    <div v-if="!exists" class="bb-miss">Доска «{{ name || path }}» не найдена — её удалили или переименовали.</div>
    <div v-else-if="d?.loaded" class="bb-view">
      <BoardView ref="view" :path="path" :text="d.text" preview />
    </div>
    <div v-else class="bb-miss">Загружаю…</div>
  </div>
</template>

<style scoped>
.bb {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}
.bb-h {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-size: 12.5px;
}
.bb-k {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}
.bb-h b {
  overflow: hidden;
  color: var(--text-hi);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bb-live {
  color: var(--up-fg);
  font-size: 11px;
}
.bb-err {
  color: var(--down-fg);
}
.grow {
  flex: 1;
}
.bb-h button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  font-size: 12px;
}
.bb-view {
  height: 380px;
  overflow: hidden;
  border-radius: 6px;
}
.bb-view :deep(.bd) {
  height: 100%;
}
.bb-miss {
  padding: 16px;
  color: var(--muted);
  font-size: 13px;
}
</style>
