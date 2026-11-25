<script setup lang="ts">
/**
 * The note's formatting toolbar: one row over the note (kept at the top while it scrolls), its buttons grouped —
 * history, headings, marks, lists, links and inserts, every component («@»). Variants of one action are one button
 * with a menu; a narrow pane hides the less used groups. A press never takes the focus from the text.
 */
import { computed, ref } from 'vue'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { NOTE_COMMANDS, type NoteCommandId } from '../../commands/registry'
import { COMPONENT_GROUP_OF, COMPONENT_GROUP_TITLE, COMPONENT_GROUPS, TOOLBAR, type ToolAction, type ToolbarWidth, type ToolItem } from './toolbarItems'

const emit = defineEmits<{ act: [a: ToolAction] }>()
/** A group hidden under a pane's width (the toolbar's own container query). */
const HIDE_BELOW: Record<ToolbarWidth, string> = { 560: 'tw:@max-[560px]:hidden', 420: 'tw:@max-[420px]:hidden' }

/** The menu open: its entry's id, and the button it hangs from (pressed again — closed). */
const menu = ref<{ id: string; anchor: HTMLElement }>()
function toggleMenu(id: string, e: MouseEvent): void {
  menu.value = menu.value?.id === id ? undefined : { id, anchor: e.currentTarget as HTMLElement }
}
const menuOpen = computed({
  get: () => !!menu.value,
  set: (on) => void (on || (menu.value = undefined)),
})
const openItems = computed(() => {
  for (const g of TOOLBAR) for (const e of g.entries) if (e.kind === 'menu' && e.id === menu.value?.id) return e.items
  return []
})
function run(a: ToolAction): void {
  menu.value = undefined
  emit('act', a)
}
const hint = (it: Pick<ToolItem, 'title' | 'keys'>) => (it.keys ? `${it.title} (${it.keys})` : it.title)

/** Every component by its group. */
const components = COMPONENT_GROUPS.map((g) => ({ id: g, title: COMPONENT_GROUP_TITLE[g], cmds: NOTE_COMMANDS.filter((c) => COMPONENT_GROUP_OF[c.id as NoteCommandId] === g) }))
</script>

<template>
  <div class="tw:@container tw:sticky tw:top-0 tw:z-5 tw:flex-none tw:bg-bg tw:border-b tw:border-border">
    <div class="tw:box-border tw:w-full tw:max-w-(--note-max,820px) tw:mx-auto tw:pl-[calc(48px+var(--note-pad,0px))] tw:@max-[420px]:pl-8 tw:pr-[calc(24px+var(--note-pad,0px))] tw:@max-[420px]:pr-8 tw:flex tw:items-center tw:h-32 tw:gap-2 tw:overflow-hidden tw:whitespace-nowrap">
      <template v-for="(g, gi) in TOOLBAR" :key="g.id">
        <div class="tw:flex tw:flex-none tw:items-center tw:gap-1" :class="g.hideBelow && HIDE_BELOW[g.hideBelow]">
          <template v-for="e in g.entries" :key="e.kind === 'button' ? e.item.id : e.kind === 'menu' ? e.id : 'components'">
            <button
              v-if="e.kind === 'button'"
              type="button"
              class="tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text"
              :title="hint(e.item)"
              @mousedown.prevent
              @click="run(e.item.action)"
            >
              <Icon :name="e.item.icon" :size="15" />
            </button>
            <button
              v-else-if="e.kind === 'menu'"
              type="button"
              class="tw:inline-flex tw:items-center tw:justify-center tw:gap-1 tw:h-26 tw:px-4 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:[&.on]:bg-hover tw:[&.on]:text-text"
              :class="{ on: menu?.id === e.id }"
              :title="e.title"
              @mousedown.prevent
              @click="toggleMenu(e.id, $event)"
            >
              <Icon :name="e.icon" :size="15" /><Icon name="chevronDown" :size="9" />
            </button>
            <button
              v-else
              type="button"
              class="tw:inline-flex tw:items-center tw:gap-4 tw:h-24 tw:ml-2 tw:px-8 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:border-accent tw:hover:text-text tw:[&.on]:border-accent tw:[&.on]:text-text"
              :class="{ on: menu?.id === 'components' }"
              title="Вставить компонент — то же, что «@» в тексте"
              @mousedown.prevent
              @click="toggleMenu('components', $event)"
            >
              <Icon name="plus" :size="13" /><span class="tw:@max-[420px]:hidden">Компонент</span><Icon name="chevronDown" :size="9" />
            </button>
          </template>
          <!-- (after the group: one hidden takes its own along) -->
          <i v-if="gi < TOOLBAR.length - 1" class="tw:w-1 tw:h-16 tw:mx-4 tw:bg-border"></i>
        </div>
      </template>
    </div>
  </div>
  <Popover v-model:open="menuOpen" :anchor="menu?.anchor" :width="menu?.id === 'components' ? 640 : 230" :chrome="0" class="tw:flex tw:flex-col tw:p-4 tw:overflow-x-hidden tw:overflow-y-auto tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop">
    <div v-if="menu?.id === 'components'" class="tw:columns-3 tw:gap-x-6">
      <div v-for="g in components" :key="g.id" class="tw:flex tw:flex-col tw:min-w-0 tw:mb-6 tw:break-inside-avoid">
        <div class="tw:px-8 tw:pt-4 tw:pb-2 tw:text-[10.5px] tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-muted">{{ g.title }}</div>
        <button
          v-for="c in g.cmds"
          :key="c.id"
          type="button"
          class="tw:flex tw:items-center tw:gap-8 tw:w-full tw:h-26 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis tw:hover:bg-hover"
          :title="c.hint"
          @mousedown.prevent
          @click="run({ kind: 'command', id: c.id as NoteCommandId })"
        >
          <Icon :name="c.icon" :size="13" class="tw:text-muted" /><span class="tw:min-w-0 tw:truncate">{{ c.title }}</span>
        </button>
      </div>
    </div>
    <template v-else>
      <button
        v-for="it in openItems"
        :key="it.id"
        type="button"
        class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:bg-hover"
        :title="hint(it)"
        @mousedown.prevent
        @click="run(it.action)"
      >
        <Icon :name="it.icon" :size="14" class="tw:text-muted" /><span class="tw:flex-1 tw:min-w-0 tw:truncate">{{ it.title }}</span><span v-if="it.keys" class="tw:text-muted tw:text-[11px]">{{ it.keys }}</span>
      </button>
    </template>
  </Popover>
</template>
