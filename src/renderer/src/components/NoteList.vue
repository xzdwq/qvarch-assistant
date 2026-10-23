<script setup lang="ts">
import { noteEntry } from '@shared/notes'
import { formatHM } from '@shared/timeline'
import type { Entry, Note } from '@shared/types'
import { kindColor, kindLabel } from '../lib/palette'
import { noteIcon } from '@shared/tracker/constants'
import Icon from './Icon.vue'
import Markdown from './Markdown.vue'
import AudioNote from './AudioNote.vue'

/** Quick notes with the block each belongs to (resolved by time). */
defineProps<{ notes: Note[]; entries: Entry[]; deletable?: boolean; editable?: boolean; editingId?: string; day?: string }>()
const emit = defineEmits<{ delete: [id: string]; select: [entryId: string]; edit: [note: Note]; toTask: [note: Note] }>()
</script>

<template>
  <div class="notes tw:flex tw:flex-col tw:gap-8">
    <template v-for="n in notes" :key="n.id">
    <slot v-if="n.id === editingId" name="editor" :note="n" />
    <div v-else class="note tw:py-8 tw:px-10 tw:rounded-[4px] tw:bg-panel-2 tw:border-l-3 tw:border-l-warn">
      <div class="nh tw:flex tw:items-center tw:gap-8 tw:text-[12px]">
        <Icon :name="noteIcon(n)":size="13" class="ni tw:text-warn" />
        <span class="time tw:tabular-nums tw:font-data tw:font-semibold">{{ formatHM(n.at) }}</span>
        <template v-for="e in [noteEntry(n, entries)]" :key="e?.id ?? 'none'">
          <button v-if="e" class="ent tw:inline-flex tw:items-center tw:gap-5 tw:py-1 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-white/6 tw:text-[12px] tw:cursor-pointer tw:hover:bg-white/12 tw:hover:enabled:border-border-3" :title="`${formatHM(e.start)}–${formatHM(e.end)}`" @click="emit('select', e.id)">
            <i class="tw:w-8 tw:h-8 tw:rounded-[50%]" :style="{ background: kindColor(e.kind) }"></i>{{ kindLabel(e.kind) }}<template v-if="e.label && e.label !== kindLabel(e.kind)"> · {{ e.label }}</template>
          </button>
          <span v-else class="muted ent-none tw:text-[12px]">вне записей</span>
        </template>
        <span class="spacer tw:flex-1"></span>
        <span v-if="n.taskId" class="tk tw:inline-flex tw:items-center tw:gap-4 tw:text-[11px] tw:text-up-fg" title="Из этой заметки сделана задача"><Icon name="checkSquare" :size="12" />задача</span>
        <button v-else-if="editable" class="mk tw:inline-flex tw:items-center tw:gap-4 tw:text-[11px] tw:py-2 tw:px-6 tw:border-0 tw:bg-transparent tw:text-accent-fg tw:cursor-pointer tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Сделать задачей" @click="emit('toTask', n)"><Icon name="checkSquare" :size="12" />В задачу</button>
        <button v-if="deletable" class="del tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted tw:rounded-r2 tw:hover:text-down-fg tw:hover:bg-down/12 tw:hover:enabled:border-border-3" title="Удалить заметку" @click="emit('delete', n.id)"><Icon name="trash" :size="13" /></button>
      </div>
      <div v-if="n.text.trim()" class="txt tw:[&.editable]:cursor-text tw:[&.editable]:rounded-r2 tw:[&.editable]:hover:bg-white/4 tw:mt-4 tw:text-[13px] tw:leading-[1.45] tw:[word-break:break-word]" :class="{ editable }" :title="editable ? 'Клик — изменить' : undefined" @click="editable && emit('edit', n)"><Markdown :text="n.text" compact /></div>
      <AudioNote v-if="n.audio && day" :day="day" :note="n" compact />
    </div>
    </template>
  </div>
</template>
