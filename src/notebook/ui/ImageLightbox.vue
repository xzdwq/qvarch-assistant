<script setup lang="ts">
import { ref } from 'vue'
import { useEscLayer } from '@renderer/lib/usePopover'

/**
 * A picture over everything, as big as the window lets it: a click closes it, so does Esc — as the last thing opened
 * (a menu opened over it closes first).
 */
const props = defineProps<{ src: string; onClose: () => void }>()
useEscLayer(ref(true), () => props.onClose())
</script>

<template>
  <div class="qa-lightbox" @click="onClose"><img :src="src" alt="" /></div>
</template>
