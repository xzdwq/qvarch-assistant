<script setup lang="ts">
/** «Запись» going on: a blinking red dot on the event (a timeline block, a row, the card). */
defineProps<{ size?: number }>()
</script>

<template>
  <i class="recdot tw:inline-block tw:flex-none tw:rounded-[50%] tw:bg-down tw:[box-shadow:0_0_6px_var(--down)] tw:animate-[RecDot-blink_1.2s_ease-in-out_infinite]" :style="{ width: `${size ?? 7}px`, height: `${size ?? 7}px` }" title="Идёт запись: конец события продлевается сам"></i>
</template>
