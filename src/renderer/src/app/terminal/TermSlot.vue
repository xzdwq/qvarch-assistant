<script setup lang="ts">
/**
 * The terminal's section: the box the one terminal is moved into while it is shown here. It is in the bottom panel
 * instead (asked there last) — said so, with «Показать здесь».
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../../components/Icon.vue'
import { dockOn, setSectionShown, showInSection, termSlot } from '../../lib/termDock'

/** On screen (its section shown). */
const props = defineProps<{ active?: boolean }>()
const box = ref<HTMLElement>()
onMounted(() => termSlot('section', box.value))
onBeforeUnmount(() => {
  termSlot('section', undefined, box.value)
  setSectionShown(false)
})
watch(() => !!props.active, setSectionShown, { immediate: true })
const elsewhere = computed(() => props.active && dockOn.value)
</script>

<template>
  <div class="tw:relative tw:h-full tw:min-h-0">
    <div ref="box" class="tw:h-full tw:min-h-0"></div>
    <div v-if="elsewhere" class="tw:absolute tw:inset-0 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-10 tw:text-muted">
      <Icon name="terminal" :size="22" />
      <span>Терминал открыт в нижней панели</span>
      <button class="tw:h-28 tw:py-0 tw:px-12" @click="showInSection">Показать здесь</button>
    </div>
  </div>
</template>
