<script setup lang="ts">
import { computed } from 'vue'
import { findLoops } from '@nb/domain/loop'
import { doc } from '@renderer/lib/notebook'
import Icon from '@renderer/components/Icon.vue'

/** A loop's end: a line closing its band (the loop it ends — by its name). */
const props = defineProps<{ path: string; line: number }>()
const loop = computed(() => findLoops(doc(props.path).text.split('\n')).find((l) => l.end === props.line))
</script>

<template>
  <div class="ble tw:flex tw:items-center tw:gap-6 tw:h-22 tw:py-0 tw:px-8 tw:border tw:border-accent/35 tw:[&&]:border-t-0 tw:[&&]:border-l-3 tw:[&&]:border-l-accent tw:rounded-[0_0_8px_8px] tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap" :title="loop ? 'Конец цикла: блоки выше, до его начала, выполняются на каждом проходе' : 'Конец без начала цикла — удалите или добавьте начало выше'">
    <Icon name="repeat" :size="11" /><span>{{ loop ? `конец цикла${loop.info.name ? ` «${loop.info.name}»` : ''}` : 'конец цикла без начала' }}</span>
  </div>
</template>
