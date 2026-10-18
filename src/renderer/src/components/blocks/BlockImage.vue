<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IMAGE_EMBED } from '@shared/vault'
import { imageUrl } from '../../lib/notebook'
import Icon from '../Icon.vue'

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
  <div class="im">
    <p v-if="missing" class="im-miss" :title="rel">Изображение не найдено</p>
    <img v-else-if="url" :src="url" alt="" draggable="false" title="Клик — в полный размер" @click="full = true" />
    <button v-if="url" class="im-full" title="Открыть в полный размер" @mousedown.prevent @click="full = true"><Icon name="zoomIn" :size="14" /></button>
    <Teleport to="body">
      <div v-if="full" class="qa-lightbox" @click="full = false"><img :src="url" alt="" /></div>
    </Teleport>
  </div>
</template>

<style scoped>
.im {
  position: relative;
  width: fit-content;
  max-width: 100%;
}
img {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  box-shadow: 0 0 0 1px var(--border);
  cursor: zoom-in;
}
.im-full {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: rgba(15, 17, 23, 0.78);
  color: #e6e9f2;
  opacity: 0;
}
.im:hover .im-full {
  opacity: 1;
}
.im-miss {
  margin: 0;
  padding: 10px 12px;
  border: 1px dashed var(--border-2);
  border-radius: 6px;
  color: var(--muted);
  font-size: 0.85em;
}
</style>
