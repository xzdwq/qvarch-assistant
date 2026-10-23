<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../../components/Icon.vue'
import { usePopover, type Placement } from '../../lib/usePopover'
import { useBrowserView } from './browserViewContext'

/** A bookmark folder's contents under its chip (teleported): its bookmarks and folders (deeper — back with ‹), dragged too. */
const view = useBrowserView()
const { openUrl } = view.tabs
const { badIcon, bmDrag, folderPop, folderAnchor, popFolder, folderBack, onBmMenu } = view.bookmarks
const { onBmDown, dropCls } = view.bookmarkDrag
/** Under its chip, from its left edge, inside the window. */
const underChip: Placement = ({ rect }) => ({ style: { left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 368))}px`, top: `${rect.bottom + 4}px` } })
const open = computed({ get: () => !!folderPop.value && !!popFolder.value, set: (on) => void (on || (folderPop.value = undefined)) })
const { panelRef, style } = usePopover(folderAnchor, { place: underChip }, open)
</script>

<template>
  <div v-if="folderPop && popFolder" :ref="panelRef" class="bmpop tw:fixed tw:z-1400 tw:flex tw:flex-col tw:min-w-220 tw:max-w-360 tw:max-h-[60vh] tw:overflow-y-auto tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop" :style="style">
    <div v-if="folderPop.trail.length" class="bmph tw:flex tw:items-center tw:gap-6 tw:pt-2 tw:pr-4 tw:pb-6 tw:pl-4 tw:border-b tw:border-b-border tw:mb-4 tw:text-text-2 tw:text-[12px]"><button class="tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted" @click="folderBack"><Icon name="chevronLeft" :size="12" /></button>{{ popFolder.title }}</div>
    <button
      v-for="c in popFolder.children"
      :key="c.id"
      class="bmrow tw:[&.nav]:h-38 tw:[&.key]:not-[&.rec]:absolute tw:[&.key]:right-52 tw:[&.rec]:relative tw:[&.rec]:flex-col tw:[&.rec]:min-w-0 tw:[&.rec]:min-h-0 tw:[&.body]:max-h-260 tw:[&.body]:overflow-auto tw:[&.body]:mt-8 tw:[&.body]:mr-0 tw:[&.body]:mb-0 tw:[&.body]:ml-0 tw:[&.body]:font-data tw:[&.body]:whitespace-pre-wrap tw:[&.body]:break-all tw:flex-none tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:touch-none tw:hover:not-[&.dragging]:not-[&.dropin]:bg-hover tw:[&.dragging]:not-[&.dropin]:bg-accent/18 tw:[&.dropin]:bg-accent/18 tw:hover:enabled:border-border-3"
      :class="[{ dragging: bmDrag === c.id }, dropCls(c.id)]"
      :data-bm="c.id"
      :title="c.url ?? c.title"
      @pointerdown="onBmDown($event, c)"
      @auxclick.prevent="$event.button === 1 && c.url && openUrl(c.url, true)"
      @contextmenu.prevent="onBmMenu(c, $event)"
    >
      <Icon v-if="c.children" name="folder" :size="13" class="bfi tw:text-warn" /><img v-else-if="c.icon && !badIcon.has(c.id)" class="bico tw:flex-none tw:w-14 tw:h-14" :src="c.icon" alt="" @error="badIcon.add(c.id)" /><Icon v-else name="globe" :size="13" class="bfi0 tw:text-muted" />
      <span class="tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ c.title }}</span>
      <Icon v-if="c.children" name="chevronRight" :size="11" />
    </button>
    <p v-if="!popFolder.children?.length" class="bmempty tw:m-8 tw:text-muted tw:text-[12px]">Пусто — перетащите сюда закладку</p>
  </div>
</template>
