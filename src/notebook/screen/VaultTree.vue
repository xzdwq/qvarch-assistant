<script setup lang="ts">
import { computed } from 'vue'
import type { VaultNode } from '@shared/vault'
import { treeRows } from '@shared/vaultTree'
import Icon from '@renderer/components/Icon.vue'
import NodeMark from '@renderer/components/NodeMark.vue'
import { isDirty } from '@nb/workspace/noteDocs'
import { curPane, layout, openFile } from '@nb/workspace/paneLayout'
import { tree } from '@nb/workspace/vaultTreeStore'
import { noteName } from '@nb/domain/notePaths'
import { useNotebookScreen } from './notebookScreen'
import { shortDate } from '@nb/domain/noteFacts'
import { runsOf, treeBadges } from '@nb/workspace/treeFacts'
import { useTreeDrop } from './useTreeDrop'

/**
 * The vault's tree: folders (sections) and notes / boards, a linked pair as one plaque; a click opens (Ctrl — in a
 * pane alongside), a double click / F2 renames in place, drag & drop moves or links, right click — the menu.
 */
const { editing, actions, transfer, menu } = useNotebookScreen()
const { folder, renaming, renameText, setRenameInput, startRename } = editing
const { newNote, finishRename } = actions
const { openTreeMenu } = menu
const { dragPath, dropDir, pairTarget, onDragStart, onDragOver, onDrop } = useTreeDrop({ moveTo: actions.moveTo, pair: actions.pair, importDropped: transfer.importDropped })

const rows = computed(() => treeRows(tree.value, layout.open, layout.sort))
/** The badge's words: with how many it is shared, a folder — whole or some of its documents. */
function shareTitle(n: VaultNode): string {
  const b = treeBadges.value.get(n.path)
  if (!b) return ''
  const who = b.people ? `людей: ${b.people}` : 'пока ни с кем, кроме вас (или сервер не на связи)'
  if (!n.dir) return `Общий документ — ${who}`
  return `${b.whole ? 'Общая папка' : 'Общие документы в папке'} — ${who}`
}
/** A folder: chosen and folded / unfolded; a note: opened. */
function clickRow(n: VaultNode, e: MouseEvent): void {
  if (n.dir) {
    folder.value = n.path
    const i = layout.open.indexOf(n.path)
    if (i >= 0) layout.open.splice(i, 1)
    else layout.open.push(n.path)
    return
  }
  folder.value = undefined
  openFile(n.path, { newPane: e.ctrlKey || e.metaKey })
}
</script>

<template>
  <div
    class="ntree tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:pt-2 tw:pr-6 tw:pb-20 tw:pl-6 tw:[&.drop]:[box-shadow:inset_0_0_0_1px_rgb(var(--accent-rgb)/0.5)]"
    :class="{ drop: dropDir === '' }"
    @dragover.prevent="onDragOver(undefined, $event)"
    @dragleave.self="dragPath || (dropDir = undefined)"
    @drop.prevent="onDrop($event)"
    @dragend="(dragPath = undefined), (dropDir = undefined)"
    @contextmenu.prevent="openTreeMenu($event)"
    @click.self="folder = undefined"
  >
    <div
      v-for="r in rows"
      :key="r.node.path"
      class="nrow tw:group/nrow tw:flex tw:items-center tw:gap-5 tw:h-27 tw:pr-6 tw:rounded-r2 tw:text-text-2 tw:text-[13px] tw:cursor-pointer tw:select-none tw:[&:not(.dir)]:h-auto tw:[&:not(.dir)]:min-h-38 tw:[&:not(.dir)]:py-3 tw:hover:not-[&.cur]:not-[&.sel]:not-[&.drop]:not-[&.grp-top]:not-[&.grp-bot]:not-[&.pairdrop]:bg-white/5 tw:[&.cur]:not-[&.sel]:not-[&.drop]:not-[&.grp-top]:not-[&.grp-bot]:not-[&.pairdrop]:bg-accent/20 tw:[&.cur]:text-text-hi tw:[&.sel]:not-[&.drop]:not-[&.grp-top]:not-[&.grp-bot]:not-[&.pairdrop]:bg-white/6 tw:[&.drop]:not-[&.grp-top]:not-[&.grp-bot]:not-[&.pairdrop]:bg-accent/25 tw:[&.drop]:not-[&.grp-top]:not-[&.grp-bot]:not-[&.pairdrop]:[box-shadow:inset_0_0_0_1px_rgb(var(--accent-rgb)/0.7)] tw:[&.grp-top]:not-[&.grp-bot]:not-[&.pairdrop]:bg-accent/7 tw:[&.grp-bot]:not-[&.pairdrop]:bg-accent/7 tw:[&.grp-top]:not-[&.grp-bot]:not-[&.pairdrop]:[box-shadow:inset_3px_0_0_rgb(var(--accent-rgb)/0.75)] tw:[&.grp-bot]:not-[&.pairdrop]:[box-shadow:inset_3px_0_0_rgb(var(--accent-rgb)/0.75)] tw:[&.grp-top]:mt-2 tw:[&.grp-top]:not-[&.grp-bot]:rounded-[4px_4px_0_0] tw:[&.grp-bot]:mb-2 tw:[&.grp-bot]:rounded-[0_0_4px_4px] tw:[&.grp-top]:hover:not-[&.grp-bot]:not-[&.cur]:bg-accent/13 tw:[&.grp-bot]:hover:not-[&.cur]:bg-accent/13 tw:[&&]:[&.grp-top]:[&.cur]:not-[&.grp-bot]:bg-accent/22 tw:[&&]:[&.grp-bot]:[&.cur]:bg-accent/22 tw:[&.pairdrop]:bg-accent/22 tw:[&.pairdrop]:[box-shadow:var(--shadow-ring-accent)]"
      :class="{ dir: r.node.dir, cur: !r.node.dir && curPane()?.active === r.node.path, sel: r.node.dir && folder === r.node.path, drop: r.node.dir && dropDir === r.node.path, pairdrop: pairTarget === r.node.path, [`grp-${r.grp}`]: !!r.grp }"
      :style="{ paddingLeft: `${6 + r.depth * 14}px` }"
      :title="r.node.path"
      draggable="true"
      @dragstart="onDragStart(r.node, $event)"
      @dragover.prevent.stop="onDragOver(r.node, $event)"
      @drop.prevent.stop="onDrop($event)"
      @click="clickRow(r.node, $event)"
      @dblclick="r.node.dir || startRename(r.node.path)"
      @contextmenu.prevent.stop="openTreeMenu($event, r.node)"
      @keydown.f2="startRename(r.node.path)"
    >
      <Icon v-if="r.node.dir" :name="layout.open.includes(r.node.path) ? 'chevronDown' : 'chevronRight'" :size="12" class="chev tw:[&&]:flex-none tw:text-muted" />
      <NodeMark v-if="r.node.dir && r.node.emoji" :emoji="r.node.emoji" :color="r.node.color" icon="folder" :size="14" class="fic tw:[&&]:flex-none tw:[&&]:text-accent-fg" />
      <Icon v-else-if="r.node.dir" :name="layout.open.includes(r.node.path) ? 'folderOpen' : 'folder'" :size="14" class="fic tw:[&&]:flex-none tw:text-accent-fg" :style="r.node.color ? { color: r.node.color } : {}" />
      <NodeMark v-else-if="r.node.emoji" :emoji="r.node.emoji" :color="r.node.color" icon="note" :size="13" class="fic emo tw:[&&]:flex-none tw:[&&]:text-accent-fg tw:ml-14 tw:-mr-3" />
      <span v-else-if="r.node.color" class="fmark tw:flex-none tw:w-10 tw:h-10 tw:mt-0 tw:mr-2 tw:mb-0 tw:ml-19 tw:rounded-r2" :style="{ background: r.node.color }"></span>
      <Icon v-else :name="r.node.board ? 'presentation' : 'note'" :size="13" class="fic note tw:[&&]:flex-none tw:ml-17 tw:text-muted" />
      <input
        v-if="renaming === r.node.path"
        :ref="setRenameInput"
        v-model="renameText"
        class="rin tw:flex-1 tw:min-w-0 tw:py-2 tw:px-5 tw:rounded-r2 tw:border tw:border-accent tw:bg-bg tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[13px] tw:outline-none"
        spellcheck="false"
        @click.stop
        @keydown.enter.prevent="finishRename(true)"
        @keydown.esc.prevent="finishRename(false)"
        @blur="finishRename(true)"
      />
      <span v-else-if="r.node.dir" class="nname tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ r.node.name }}</span>
      <span v-else class="ncol tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:leading-[1.2]">
        <span class="nname tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ r.node.name }}</span><small class="vtree-date">{{ shortDate(r.node.ctime) }}</small>
        <!-- the runnable components: one line, the rest hidden behind «…» -->
        <span v-if="runsOf(r.node).length" class="tw:block tw:min-w-0 tw:mt-2 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:leading-14 tw:text-dim tw:text-[10px]" :title="`Компоненты: ${runsOf(r.node).join(', ')}`"><b v-for="c in runsOf(r.node)" :key="c" class="tw:inline-block tw:mr-3 tw:px-4 tw:rounded-r1 tw:bg-white/7 tw:font-data tw:font-normal tw:text-text-2">{{ c }}</b></span>
      </span>
      <span v-if="treeBadges.get(r.node.path)" class="tw:inline-flex tw:flex-none tw:items-center tw:gap-2 tw:h-16 tw:px-4 tw:rounded-[8px] tw:font-data tw:text-[10.5px] tw:[&.whole]:bg-accent/16 tw:[&.whole]:text-accent-fg tw:[&.part]:bg-warn/16 tw:[&.part]:text-warn-fg" :class="treeBadges.get(r.node.path)!.whole ? 'whole' : 'part'" :title="shareTitle(r.node)"><Icon name="users" :size="10" /><template v-if="treeBadges.get(r.node.path)!.people">{{ treeBadges.get(r.node.path)!.people }}</template></span>
      <span v-if="r.node.pair" class="npair tw:inline-flex tw:flex-none tw:text-accent-fg tw:group-[.grp-top]/nrow:not-group-[.grp-bot]/nrow:hidden tw:group-[.grp-bot]/nrow:hidden" :title="'Связано с: ' + noteName(r.node.pair)"><Icon name="link" :size="11" /></span>
      <span v-if="!r.node.dir && isDirty(r.node.path)" class="ndot tw:flex-none tw:w-6 tw:h-6 tw:rounded-[50%] tw:bg-warn" title="Сохраняется…"></span>
    </div>
    <div v-if="!rows.length" class="nempty tw:py-12 tw:px-10 tw:text-muted tw:text-[12.5px]">
      Пока пусто.
      <button class="lnk tw:inline-flex tw:items-center tw:gap-4 tw:p-0 tw:border-0 tw:[background:none] tw:text-accent-fg tw:text-[12px] tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text tw:hover:enabled:not-[.zoom_&]:bg-hover tw:hover:enabled:not-[.zoom_&]:border-border-3" @click="newNote('')">Создать заметку</button>
    </div>
  </div>
</template>
