<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IMAGE_EMBED } from '@shared/vault'
import { imageUrl } from '@renderer/lib/notebook'
import Icon from '@renderer/components/Icon.vue'

/** A picture of the note: as wide as the note at most; a click — the full size over everything. */
const props = defineProps<{ src: string }>()
const rel = computed(() => IMAGE_EMBED.exec(props.src.trim())?.[1] ?? '')
const url = ref('')
const missing = ref(false)
watch(
  rel,
  (r) => {
    missing.value = false
    if (r)
      void imageUrl(r)
        .then((u) => (url.value = u))
        .catch(() => (missing.value = true))
  },
  { immediate: true },
)
const full = ref(false)
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') full.value = false
}
watch(full, (on) => (on ? window.addEventListener('keydown', onKey, true) : window.removeEventListener('keydown', onKey, true)))
</script>

<template>
  <div class="im tw:group/im tw:relative tw:w-fit tw:max-w-full">
    <p v-if="missing" class="im-miss tw:m-0 tw:py-10 tw:px-12 tw:border tw:border-dashed tw:border-border-2 tw:rounded-[6px] tw:text-muted tw:text-[0.85em]" :title="rel">Изображение не найдено</p>
    <img class="tw:block tw:max-w-full tw:h-auto tw:rounded-[6px] tw:[box-shadow:0_0_0_1px_var(--border)] tw:cursor-zoom-in" v-else-if="url" :src="url" alt="" draggable="false" title="Клик — в полный размер" @click="full = true" />
    <button v-if="url" class="im-full tw:absolute tw:top-6 tw:right-6 tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[6px] tw:bg-(--image-tool-bg) tw:text-(--image-tool-fg) tw:opacity-0 tw:group-hover/im:opacity-100 tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Открыть в полный размер" @mousedown.prevent @click="full = true"><Icon name="zoomIn" :size="14" /></button>
    <Teleport to="body">
      <div v-if="full" class="qa-lightbox" @click="full = false"><img class="tw:block tw:max-w-full tw:h-auto tw:rounded-[6px] tw:[box-shadow:0_0_0_1px_var(--border)] tw:cursor-zoom-in" :src="url" alt="" /></div>
    </Teleport>
  </div>
</template>
