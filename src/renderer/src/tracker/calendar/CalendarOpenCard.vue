<script setup lang="ts">
import EntryEditor from '../../components/EntryEditor.vue'
import NoteEditor from '../../components/NoteEditor.vue'
import DatePick from '../../components/DatePick.vue'
import Icon from '../../components/Icon.vue'
import { openUrl } from '../../lib/links'
import { useCalendarState } from './useTaskCalendar'

/** The open item in the middle of the side list: the event card (or the note editor) with its task / meeting info. */
const { els, panel, isOff, toNum, fmt, cap, panelEntry, isToday, nowMs, panelDay, onSaved, onCopied, setPanelDay, onPanelClosed, onDraftRange, formatDuration, totals, openJira, panelNoteId, reloadVisible, dateLocked } = useCalendarState()
</script>

<template>
  <div v-if="panel" :ref="els.curEl" class="ngroup current tw:pb-6 tw:border-b tw:border-b-border tw:grid tw:grid-cols-[38px_minmax(0,1fr)] tw:gap-6 tw:items-start">
    <div class="gday tw:group/gday tw:sticky tw:top-0 tw:flex tw:flex-col tw:items-center tw:pt-2 tw:leading-[1.1] tw:text-muted tw:text-[10px] tw:lowercase tw:[&.off]:text-down-fg" :class="{ off: isOff(toNum(panel.day)) }"><span>{{ fmt(panel.day, { weekday: 'short' }) }}</span><b class="tw:text-[17px] tw:text-accent-fg">{{ +panel.day.slice(8) }}</b><small>{{ fmt(panel.day, { month: 'short' }) }}</small></div>
    <div class="ccard tw:flex tw:flex-col tw:gap-8 tw:py-10 tw:px-12 tw:rounded-[4px] tw:border tw:border-accent/60 tw:bg-accent/7 tw:[box-shadow:0_0_0_3px_rgb(var(--accent-rgb)/0.12)]">
    <template v-if="panel.type === 'entry'">
      <EntryEditor
        :key="panel.key"
        :day="panel.day"
        :entry="panelEntry ?? panel.entry"
        :recent="[]"
        :now="isToday(panel.day) ? nowMs : undefined"
        :entries="panelDay?.entries ?? []"
        :notes="panelDay?.notes ?? []"
        textarea
        @saved="onSaved"
        @copied="onCopied"
        @day="setPanelDay"
        @deleted="onPanelClosed"
        @close="onPanelClosed"
        @range="onDraftRange"
      >
      </EntryEditor>
      <div v-if="panelEntry && (panelEntry.task || panelEntry.outlook)" class="sinfo tw:flex tw:flex-col tw:gap-4 tw:py-8 tw:px-10 tw:rounded-[4px] tw:bg-white/3 tw:text-[12px]">
        <div v-if="panelEntry.task" class="srow tw:flex tw:items-center tw:gap-6 tw:min-w-0">
          <Icon :name="panelEntry.task.key.startsWith('Q-') ? 'checkSquare' : 'jira'" :size="12" />
          <b>{{ panelEntry.task.key }}</b>
          <span class="muted">всего по задаче {{ formatDuration(totals[panelEntry.task.key] ?? 0) }}</span>
          <button v-if="!panelEntry.task.key.startsWith('Q-')" class="lnk tw:p-0 tw:border-0 tw:bg-transparent tw:text-accent-fg tw:text-[12px] tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="openJira(panelEntry.task.key)">в Jira</button>
        </div>
        <div v-if="panelEntry.outlook" class="srow tw:flex tw:items-center tw:gap-6 tw:min-w-0">
          <Icon name="outlook" :size="12" />Встреча из Outlook
          <button v-if="panelEntry.outlook.joinUrl && panelEntry.end > nowMs" class="lnk tw:p-0 tw:border-0 tw:bg-transparent tw:text-accent-fg tw:text-[12px] tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="openUrl(panelEntry.outlook.joinUrl)">Teams</button>
        </div>
      </div>
    </template>
    <template v-else>
      <NoteEditor
        :key="panel.note.id"
        :day="panel.day"
        :note="panel.note"
        :entries="panelDay?.entries ?? []"
        :notes="panelDay?.notes ?? []"
        :full="panelDay?.notes.find((x) => x.id === panelNoteId)"
        @close="onPanelClosed"
        @saved="reloadVisible"
      >
        <template #date>
        <div class="pdate-row tw:-mt-4">
          <span v-if="dateLocked" class="pdate tw:inline-flex tw:items-center tw:gap-6 tw:py-3 tw:px-8 tw:border tw:border-border tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12px] tw:hover:enabled:border-accent/60 tw:disabled:border-transparent tw:disabled:text-muted" title="Дата заметки"><Icon name="calendar" :size="13" />{{ cap(fmt(panel.day, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })) }}</span>
          <DatePick v-else :model-value="panel.day" @update:model-value="(d) => d && setPanelDay(d)" />
        </div>
      </template>
      </NoteEditor>
    </template>
    </div>
  </div>
</template>
