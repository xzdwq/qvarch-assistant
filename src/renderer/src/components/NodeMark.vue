<script setup lang="ts">
import Icon from './Icon.vue'

/**
 * A note's / a board's mark: its emoji (on its colour's tint when it has a colour too), else its colour, else
 * its icon. The same in the tree, the tabs and the note's title line.
 */
defineProps<{ emoji?: string; color?: string; icon: string; size?: number }>()
</script>

<template>
  <span v-if="emoji" class="nm-e" :class="{ tint: !!color }" :style="{ fontSize: `${(size ?? 13) + 1}px`, ...(color ? { background: `color-mix(in srgb, ${color} 30%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 60%, transparent)` } : {}) }">{{ emoji }}</span>
  <span v-else-if="color" class="nm-c" :style="{ background: color, width: `${(size ?? 13) - 3}px`, height: `${(size ?? 13) - 3}px` }"></span>
  <Icon v-else :name="icon" :size="size ?? 13" class="nm-i" />
</template>

<style scoped>
.nm-e {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.3em;
  height: 1.3em;
  border-radius: 5px;
  font-family: 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif;
  line-height: 1;
}
.nm-c {
  flex: none;
  display: inline-block;
  border-radius: var(--r2);
}
.nm-i {
  flex: none;
  color: var(--muted);
}
</style>
