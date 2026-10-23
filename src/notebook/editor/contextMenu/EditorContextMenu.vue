<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@renderer/components/Icon.vue'
import { usePopover } from '@renderer/lib/usePopover'
import type { EditorContextMenuState } from './useEditorContextMenu'

/** The editor's right-click menu, drawn over everything where it was asked for (its state — useEditorContextMenu). */
const props = defineProps<{ menu: EditorContextMenuState }>()
const open = computed({ get: () => !!props.menu.open, set: (on) => void (on || props.menu.close()) })
const { panelRef, style } = usePopover(() => props.menu.open, {}, open)
</script>

<template>
  <Teleport to="body">
    <div v-if="menu.open" :ref="panelRef" class="mde-menu" :style="style" @contextmenu.prevent>
      <button :disabled="!menu.open.sel" @click="menu.act('cut')"><Icon name="scissors" :size="14" />Вырезать<kbd>Ctrl+X</kbd></button>
      <button :disabled="!menu.open.sel" @click="menu.act('copy')"><Icon name="copy" :size="14" />Копировать<kbd>Ctrl+C</kbd></button>
      <button @click="menu.act('paste')"><Icon name="clipboard" :size="14" />Вставить<kbd>Ctrl+V</kbd></button>
      <button @click="menu.act('all')"><Icon name="checkSquare" :size="14" />Выделить всё<kbd>Ctrl+A</kbd></button>
      <template v-if="menu.open.sel">
        <hr />
        <button class="ev" @click="menu.act('event')"><Icon name="plus" :size="14" />В событие</button>
        <hr />
        <button @click="menu.act('code')"><Icon name="code" :size="14" />Код</button>
        <button @click="menu.act('bold')"><Icon name="bold" :size="14" />Жирный<kbd>Ctrl+B</kbd></button>
        <button @click="menu.act('heading')"><Icon name="heading" :size="14" />Заголовок</button>
        <button @click="menu.act('list')"><Icon name="list" :size="14" />Список</button>
      </template>
    </div>
  </Teleport>
</template>

<style src="./EditorContextMenu.global.css"></style>
