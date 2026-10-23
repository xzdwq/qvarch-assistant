<script setup lang="ts">
import { computed } from 'vue'
import { findLoops } from '@shared/loop'
import { doc } from '../../lib/notebook'
import Icon from '../Icon.vue'

/** A loop's end: a line closing its band (the loop it ends — by its name). */
const props = defineProps<{ path: string; line: number }>()
const loop = computed(() => findLoops(doc(props.path).text.split('\n')).find((l) => l.end === props.line))
</script>

<template>
  <div class="ble" :title="loop ? 'Конец цикла: блоки выше, до его начала, выполняются на каждом проходе' : 'Конец без начала цикла — удалите или добавьте начало выше'">
    <Icon name="repeat" :size="11" /><span>{{ loop ? `конец цикла${loop.info.name ? ` «${loop.info.name}»` : ''}` : 'конец цикла без начала' }}</span>
  </div>
</template>

<style scoped>
.ble {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid rgb(var(--accent-rgb) / 0.35);
  border-top: 0;
  border-left: 3px solid var(--accent);
  border-radius: 0 0 8px 8px;
  color: var(--muted);
  font-size: 11.5px;
  white-space: nowrap;
}
</style>
