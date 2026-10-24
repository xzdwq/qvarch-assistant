<script setup lang="ts">
import type { VaultNode } from '@shared/vault'
import Icon from '@renderer/components/Icon.vue'
import { cssHex } from '@renderer/lib/cssColor'
import { atPoint, openWhile, usePopover } from '@renderer/lib/usePopover'
import { openFile } from '@nb/workspace/paneLayout'
import { shareFolder } from '@nb/workspace/sharedFolders'
import { remoteError } from '@shared/remoteError'
import { useNotebookScreen } from './notebookScreen'
import { QUICK_EMOJI } from '@nb/domain/noteFacts'

/**
 * The tree's right-click menu: on a folder or the empty space — new note / board / folder, import; on a file — open,
 * its linked one, unlink; on a node — rename, show in Explorer, export, its colour and emoji, delete. A popover at the
 * click (the point already fitted into the window).
 */
const props = defineProps<{ menu: { x: number; y: number; node?: VaultNode } }>()
const { actions, transfer, editing, menu: treeMenu, toast } = useNotebookScreen()
const { newNote, newBoard, newFolder, pair, remove, setColor, setEmoji } = actions
const { importDoc, exportDoc } = transfer
const { startRename } = editing
const { runOnNode, moreEmoji } = treeMenu
const { panelRef, style } = usePopover(() => props.menu, { place: atPoint }, openWhile(treeMenu.treeMenu))
const reveal = (p: string) => window.qa.vaultReveal(p)
/** A folder shared; the code is given by «Совместная работа» of any of its notes. */
async function sharePath(dir: string): Promise<void> {
  try {
    await shareFolder(dir)
    toast.say('Папка общая — пригласите участников кнопкой «Совместная работа» у любой её заметки')
  } catch (e) {
    toast.say(remoteError(e))
  }
}
/** The marks a node can take (styles/colors/notebook.css), as the hex kept in the vault. */
const markColors = Array.from({ length: 7 }, (_, i) => cssHex(`--note-mark-${i + 1}`)).filter((c): c is string => !!c)
</script>

<template>
  <div :ref="panelRef" class="nctx tw:fixed tw:z-5000 tw:min-w-210 tw:p-5 tw:rounded-[4px] tw:border tw:border-white/10 tw:bg-panel-2 tw:[box-shadow:var(--shadow-menu)] tw:flex tw:flex-col" :style="style" @pointerdown.stop>
    <template v-if="!menu.node || menu.node.dir">
      <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20" @click="runOnNode((n) => newNote(n?.path ?? ''))"><Icon name="filePlus" :size="13" />Новая заметка</button>
      <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20" @click="runOnNode((n) => newBoard(n?.path ?? ''))"><Icon name="presentation" :size="13" />Новая доска</button>
      <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20" @click="runOnNode((n) => newFolder(n?.path ?? ''))"><Icon name="folderPlus" :size="13" />Новый раздел</button>
      <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20" @click="runOnNode((n) => importDoc(n?.path ?? ''))"><Icon name="download" :size="13" />Импорт документа…</button>
      <button v-if="menu.node" class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20" title="Все заметки папки — общие: правка вместе, новые и перемещённые заметки видны всем участникам" @click="runOnNode((n) => sharePath(n!.path))"><Icon name="users" :size="13" />Открыть доступ к папке</button>
    </template>
    <template v-if="menu.node && !menu.node.dir">
      <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20" @click="runOnNode((n) => openFile(n!.path))"><Icon name="note" :size="13" />Открыть</button>
      <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20" @click="runOnNode((n) => openFile(n!.path, { newPane: true }))"><Icon name="columns" :size="13" />Открыть справа</button>
      <template v-if="menu.node.pair">
        <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20" @click="runOnNode((n) => openFile(n!.pair!))"><Icon :name="menu.node.board ? 'note' : 'presentation'" :size="13" />Открыть связанную {{ menu.node.board ? 'заметку' : 'доску' }}</button>
        <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20" @click="runOnNode((n) => pair(n!.path))"><Icon name="link" :size="13" />Отвязать</button>
      </template>
    </template>
    <template v-if="menu.node">
      <div class="csep tw:h-1 tw:my-4 tw:mx-6 tw:bg-white/8"></div>
      <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20" @click="runOnNode((n) => startRename(n!.path))"><Icon name="pencil" :size="13" />Переименовать</button>
      <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20" @click="runOnNode((n) => reveal(n!.path))"><Icon name="external" :size="13" />Показать в проводнике</button>
      <button class="tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20" :title="menu.node.dir ? 'Вся папка одним файлом .qvdoc: подпапки, заметки, доски, картинки — откроется на другом компьютере' : 'Один файл .qvdoc: с картинками, аудио, досками — откроется на другом компьютере'" @click="runOnNode((n) => exportDoc(n!.path))"><Icon name="upload" :size="13" />{{ menu.node.dir ? 'Экспорт папки в файл…' : 'Экспорт в файл…' }}</button>
      <div class="csep tw:h-1 tw:my-4 tw:mx-6 tw:bg-white/8"></div>
      <div class="ccolors tw:flex tw:items-center tw:gap-6 tw:pt-4 tw:pr-10 tw:pb-6 tw:pl-10" title="Цветная метка">
        <button class="cnone tw:[.zoom_&]:min-w-20 tw:flex tw:items-center tw:gap-8 tw:bg-transparent tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20 tw:w-18 tw:h-18 tw:p-0 tw:rounded-r2 tw:justify-center tw:border tw:border-white/20 tw:text-muted tw:[&.on]:border-text-hi" :class="{ on: !menu.node.color }" title="Без цвета" @click="runOnNode((n) => setColor(n!))"><Icon name="x" :size="11" /></button>
        <button v-for="c in markColors" :key="c" class="cdot tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20 tw:w-18 tw:h-18 tw:p-0 tw:rounded-r2 tw:justify-center tw:[&.on]:[box-shadow:0_0_0_2px_var(--panel-2),0_0_0_3.5px_var(--text-hi)]" :class="{ on: menu.node.color === c }" :style="{ background: c }" @click="runOnNode((n) => setColor(n!, c))"></button>
      </div>
      <div class="ccolors cemo tw:flex tw:items-center tw:pt-4 tw:pr-10 tw:pb-6 tw:pl-10 tw:gap-2" title="Эмодзи-метка (вместе с цветом — на его подложке)">
        <button class="cnone tw:[.zoom_&]:min-w-20 tw:flex tw:items-center tw:gap-8 tw:bg-transparent tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20 tw:w-18 tw:h-18 tw:p-0 tw:rounded-r2 tw:justify-center tw:border tw:border-white/20 tw:text-muted tw:[&.on]:border-text-hi" :class="{ on: !menu.node.emoji }" title="Без эмодзи" @click="runOnNode((n) => setEmoji(n!))"><Icon name="x" :size="11" /></button>
        <button v-for="e in QUICK_EMOJI" :key="e" class="ce tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:hover:text-text tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-text tw:text-left tw:hover:bg-accent/20 tw:p-0 tw:rounded-r2 tw:justify-center tw:w-22 tw:h-22 tw:font-['Segoe_UI_Emoji','Apple_Color_Emoji','Noto_Color_Emoji',sans-serif] tw:text-[14px] tw:[&.on]:[box-shadow:0_0_0_1.5px_var(--text-hi)]" :class="{ on: menu.node.emoji === e }" @click="runOnNode((n) => setEmoji(n!, e))">{{ e }}</button>
        <button class="ce more tw:[.zoom_&]:min-w-20 tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:hover:bg-accent/20 tw:p-0 tw:rounded-r2 tw:justify-center tw:w-22 tw:h-22 tw:font-['Segoe_UI_Emoji','Apple_Color_Emoji','Noto_Color_Emoji',sans-serif] tw:text-[14px] tw:text-muted" title="Все эмодзи — с поиском" @click="moreEmoji"><Icon name="more" :size="12" /></button>
      </div>
      <div class="csep tw:h-1 tw:my-4 tw:mx-6 tw:bg-white/8"></div>
      <button class="danger tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-[12.5px] tw:text-left tw:hover:bg-accent/20 tw:text-down-fg" @click="runOnNode((n) => remove(n!))"><Icon name="trash" :size="13" />Удалить</button>
    </template>
  </div>
</template>
