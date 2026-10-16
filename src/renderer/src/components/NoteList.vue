<script setup lang="ts">
import { noteEntry } from '@shared/notes'
import { formatHM } from '@shared/timeline'
import type { Entry, Note } from '@shared/types'
import { kindColor, kindLabel } from '../lib/palette'
import Icon from './Icon.vue'
import Markdown from './Markdown.vue'
import AudioNote from './AudioNote.vue'

/** Quick notes with the block each belongs to (resolved by time). */
defineProps<{ notes: Note[]; entries: Entry[]; deletable?: boolean; editable?: boolean; editingId?: string; day?: string }>()
const emit = defineEmits<{ delete: [id: string]; select: [entryId: string]; edit: [note: Note]; toTask: [note: Note] }>()
</script>

<template>
  <div class="notes">
    <template v-for="n in notes" :key="n.id">
    <slot v-if="n.id === editingId" name="editor" :note="n" />
    <div v-else class="note">
      <div class="nh">
        <Icon :name="n.audio ? (n.audio.kind === 'call' ? 'phone' : 'mic') : 'note'" :size="13" class="ni" />
        <span class="time">{{ formatHM(n.at) }}</span>
        <template v-for="e in [noteEntry(n, entries)]" :key="e?.id ?? 'none'">
          <button v-if="e" class="ent" :title="`${formatHM(e.start)}–${formatHM(e.end)}`" @click="emit('select', e.id)">
            <i :style="{ background: kindColor(e.kind) }"></i>{{ kindLabel(e.kind) }}<template v-if="e.label && e.label !== kindLabel(e.kind)"> · {{ e.label }}</template>
          </button>
          <span v-else class="muted ent-none">вне записей</span>
        </template>
        <span class="spacer"></span>
        <span v-if="n.taskId" class="tk" title="Из этой заметки сделана задача"><Icon name="checkSquare" :size="12" />задача</span>
        <button v-else-if="editable" class="mk" title="Сделать задачей" @click="emit('toTask', n)"><Icon name="checkSquare" :size="12" />В задачу</button>
        <button v-if="deletable" class="del" title="Удалить заметку" @click="emit('delete', n.id)"><Icon name="trash" :size="13" /></button>
      </div>
      <div v-if="n.text.trim()" class="txt" :class="{ editable }" :title="editable ? 'Клик — изменить' : undefined" @click="editable && emit('edit', n)"><Markdown :text="n.text" compact /></div>
      <AudioNote v-if="n.audio && day" :day="day" :note="n" compact />
    </div>
    </template>
  </div>
</template>

<style scoped>
.notes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.note {
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--panel-2);
  border-left: 3px solid var(--warn);
}
.nh {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.ni {
  color: var(--warn);
}
.time {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  font-weight: 600;
}
.ent {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border: 0;
  border-radius: var(--r2);
  background: rgba(255, 255, 255, 0.06);
  font-size: 12px;
  cursor: pointer;
}
.ent:hover {
  background: rgba(255, 255, 255, 0.12);
}
.ent i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.ent-none {
  font-size: 12px;
}
.spacer {
  flex: 1;
}
.tk,
.mk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}
.tk {
  color: var(--up-fg);
}
.mk {
  padding: 2px 6px;
  border: 0;
  background: transparent;
  color: var(--accent-fg);
  cursor: pointer;
}
.del {
  display: inline-flex;
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--muted);
  border-radius: var(--r2);
}
.del:hover {
  color: var(--down-fg);
  background: rgba(255, 61, 61, 0.12);
}
.txt.editable {
  cursor: text;
  border-radius: var(--r2);
}
.txt.editable:hover {
  background: rgba(255, 255, 255, 0.04);
}
.txt {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.45;
  word-break: break-word;
}
</style>
