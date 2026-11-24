<script setup lang="ts">
import { computed, reactive } from 'vue'
import { folderTreeRows } from '@shared/browser/bookmarkTree'
import Icon from '../../components/Icon.vue'
import { bookmarks } from '../../lib/browser'

/**
 * Where a bookmark goes: the bookmarks bar and its folders as a tree (each folder's own inside it, shut / opened by
 * its arrow); `skip` — the folder being moved, left out with all inside it (a folder never goes into itself).
 */
const props = defineProps<{ skip?: string }>()
/** The folder chosen ('' — the bar itself). */
const folder = defineModel<string>({ required: true })
const shut = reactive(new Set<string>())
const rows = computed(() => folderTreeRows(bookmarks.value, shut, props.skip))
const toggle = (id: string) => void (shut.has(id) ? shut.delete(id) : shut.add(id))
/** A row's indent by its depth (the bar is the root: its folders one step in). */
const indent = (depth: number) => ({ paddingLeft: `${6 + depth * 16}px` })
</script>

<template>
  <div class="bft tw:flex tw:flex-col tw:max-h-260 tw:overflow-y-auto tw:p-3 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-field" role="tree">
    <button type="button" role="treeitem" :aria-selected="folder === ''" class="tw:flex tw:items-center tw:gap-6 tw:h-26 tw:pr-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-hover tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg" :class="{ on: folder === '' }" :style="indent(0)" @click="folder = ''">
      <Icon name="star" :size="13" class="tw:flex-none tw:text-muted" /><span class="tw:min-w-0 tw:truncate">Панель закладок</span>
    </button>
    <div v-for="r in rows" :key="r.id" role="treeitem" :aria-selected="folder === r.id" :aria-expanded="r.branches ? r.open : undefined" class="tw:flex tw:items-center tw:h-26 tw:rounded-r2 tw:hover:bg-hover tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg" :class="{ on: folder === r.id }" :style="indent(r.depth + 1)">
      <button v-if="r.branches" type="button" class="tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-18 tw:h-18 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:text-text" :title="r.open ? 'Свернуть' : 'Развернуть'" @click="toggle(r.id)"><Icon :name="r.open ? 'chevronDown' : 'chevronRight'" :size="12" /></button>
      <span v-else class="tw:flex-none tw:w-18" />
      <button type="button" class="tw:flex tw:flex-1 tw:min-w-0 tw:items-center tw:gap-6 tw:h-full tw:pr-8 tw:border-0 tw:bg-transparent tw:text-inherit tw:text-[12.5px] tw:text-left" @click="folder = r.id">
        <Icon :name="folder === r.id ? 'folderOpen' : 'folder'" :size="13" class="tw:flex-none tw:text-muted" /><span class="tw:min-w-0 tw:truncate">{{ r.title }}</span>
      </button>
    </div>
  </div>
</template>
