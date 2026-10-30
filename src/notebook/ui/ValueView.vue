<script setup lang="ts">
/**
 * A value or a result shown (pretty JSON or its text; a huge one cut on screen) with «Скачать» in its corner — the
 * whole value as a file, whatever its size (JSON; a plain text — .txt). `parse` — a text is shown and kept as JSON
 * when it is one (an answer's body).
 */
import { computed, ref } from 'vue'
import { prettyValue, valueFile } from '@nb/domain/values'
import { remoteError } from '@shared/remoteError'
import CodeArea from '@renderer/components/CodeArea.vue'
import Icon from '@renderer/components/Icon.vue'

const props = withDefaults(defineProps<{ value: unknown; name?: string; parse?: boolean; minHeight?: number }>(), { name: '', parse: false, minHeight: 24 })
const file = computed(() => valueFile(props.value, props.parse))
const shown = computed(() => (file.value.ext === 'json' && typeof props.value === 'string' ? prettyValue(file.value.text) : prettyValue(props.value)))
const said = ref('')
async function save(): Promise<void> {
  said.value = ''
  const { text, ext } = file.value
  const base = (props.name || 'значение').replace(/[\\/:*?"<>|]+/g, '_')
  try {
    await window.qa.fileSave(new TextEncoder().encode(text), `${base}.${ext}`, ext)
  } catch (e) {
    said.value = remoteError(e)
  }
}
</script>

<template>
  <div class="tw:group/val tw:relative tw:min-w-0">
    <CodeArea :model-value="shown" :lang="file.ext === 'json' ? 'json' : 'text'" readonly :min-height="minHeight" />
    <button
      class="tw:absolute tw:top-4 tw:right-4 tw:z-2 tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:p-0 tw:border tw:border-border-2 tw:rounded-[5px] tw:bg-panel tw:text-muted tw:opacity-60 tw:group-hover/val:opacity-100 tw:hover:text-text tw:hover:bg-hover"
      :title="`Скачать целиком (${file.ext === 'json' ? 'JSON' : 'текст'})`"
      @mousedown.prevent
      @click="save"
    >
      <Icon name="download" :size="12" />
    </button>
    <p v-if="said" class="tw:m-0 tw:mt-4 tw:text-down-fg tw:text-[11.5px]">{{ said }}</p>
  </div>
</template>
