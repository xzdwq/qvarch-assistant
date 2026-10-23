<script setup lang="ts">
import Icon from './Icon.vue'

/**
 * A note's / a board's mark: its emoji (on its colour's tint when it has a colour too), else its colour, else
 * its icon. The same in the tree, the tabs and the note's title line.
 */
defineProps<{ emoji?: string; color?: string; icon: string; size?: number }>()
</script>

<template>
  <span v-if="emoji" class="nm-e tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:min-w-[1.3em] tw:h-[1.3em] tw:rounded-[5px] tw:font-['Segoe_UI_Emoji','Apple_Color_Emoji','Noto_Color_Emoji',sans-serif] tw:leading-none" :class="{ tint: !!color }" :style="{ fontSize: `${(size ?? 13) + 1}px`, ...(color ? { background: `color-mix(in srgb, ${color} 30%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 60%, transparent)` } : {}) }">{{ emoji }}</span>
  <span v-else-if="color" class="nm-c tw:flex-none tw:inline-block tw:rounded-r2" :style="{ background: color, width: `${(size ?? 13) - 3}px`, height: `${(size ?? 13) - 3}px` }"></span>
  <Icon v-else :name="icon" :size="size ?? 13" class="nm-i tw:[&&]:flex-none tw:text-muted" />
</template>
