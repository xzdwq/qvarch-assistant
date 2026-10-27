<script setup lang="ts">
import Icon from '@renderer/components/Icon.vue'
import { layout } from '@nb/workspace/paneLayout'
import { files } from '@nb/workspace/vaultTreeStore'
import { useNotebookScreen } from './notebookScreen'
import { notesCount } from '@nb/domain/noteFacts'
import SideTools from './SideTools.vue'
import VaultTree from './VaultTree.vue'
import VaultSearch from './VaultSearch.vue'

/** The notes side: its tool bar, the tree or the search, the count of notes with import and the vault's folder. */
const { editing, transfer } = useNotebookScreen()
const { targetDir } = editing
const { importDoc } = transfer
const reveal = (p: string) => window.qa.vaultReveal(p)
</script>

<template>
  <aside class="nside tw:flex-none tw:flex tw:flex-col tw:min-h-0 tw:bg-bg" :style="{ width: `${layout.side}px` }">
    <SideTools />
    <VaultTree v-if="layout.sideTab === 'files'" />
    <VaultSearch v-else />
    <div class="nfoot tw:flex-none tw:flex tw:items-center tw:gap-6 tw:py-8 tw:px-12 tw:border-t tw:border-t-border tw:text-muted tw:text-[11.5px]">
      <span>{{ notesCount(files.length) }}</span>
      <span class="grow tw:flex-1"></span>
      <button class="lnk tw:inline-flex tw:items-center tw:gap-4 tw:p-0 tw:border-0 tw:[background:none] tw:text-accent-fg tw:text-[12px] tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text tw:hover:enabled:not-[.zoom_&]:bg-hover tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Импорт документа (.qvdoc) туда, где фокус в дереве (без фокуса — в корень)" @click="importDoc(targetDir)"><Icon name="download" :size="12" />Импорт</button>
      <button class="lnk tw:inline-flex tw:items-center tw:gap-4 tw:p-0 tw:border-0 tw:[background:none] tw:text-accent-fg tw:text-[12px] tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text tw:hover:enabled:not-[.zoom_&]:bg-hover tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Папка с файлами заметок" @click="reveal('')"><Icon name="external" :size="12" />Папка</button>
    </div>
  </aside>
</template>
