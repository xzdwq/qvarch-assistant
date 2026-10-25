<script setup lang="ts">
import DictateButton from '../../components/DictateButton.vue'
import Icon from '../../components/Icon.vue'
import OffsetField from '../../components/OffsetField.vue'
import QuickField from '../../components/QuickField.vue'
import { kindLabel } from '../../lib/palette'
import { useIsland } from '../islandState'

/**
 * The area under (or above) the pill the orb opens: tabs Текст (a note saved while typing, or made a task),
 * Аудио (a voice note), Событие (a block in a couple of clicks), Звонок (record the call).
 */
const { els, day, quick, quickEvent, chat, switchOrb } = useIsland()
const { today, live, shownKinds } = day
const { noteOpen, note, qtab, qMsg, noteTarget, onNoteInput, onNoteKey, quickToTask } = quick
const { recording, recLevel, recSec, startRec, stopRec, fmtRec } = quick
const { qKind, qOff, qLabel, qTask, qParsed, addQuickEvent } = quickEvent
</script>

<template>
  <div v-if="noteOpen && note" class="pnote tw:absolute tw:left-10 tw:right-10 tw:top-full tw:h-128 tw:flex tw:flex-col tw:gap-4 tw:cursor-auto tw:animate-[Island-nslide_0.3s_cubic-bezier(0.32,0.72,0,1)_0.05s_both] tw:group-[.up]/stage:top-auto tw:group-[.up]/stage:bottom-full tw:group-[.up]/stage:pt-6" @click.stop>
    <div class="nhead tw:flex tw:items-center tw:gap-6 tw:text-[11px] tw:text-warn-fg tw:whitespace-nowrap tw:overflow-hidden">
      <span class="qtabs tw:flex-none tw:inline-flex tw:border tw:border-white/12 tw:rounded-r2 tw:overflow-hidden tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">
        <button class="tw:inline-flex tw:items-center tw:gap-4 tw:py-2 tw:px-8 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11px] tw:[&.on]:bg-warn/16 tw:[&.on]:text-warn-fg tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-[&.on]:bg-transparent tw:[.seg2_&]:[&.on]:bg-accent tw:[.seg2_&]:[&.on]:text-on-accent" :class="{ on: qtab === 'text' }" @click="qtab = 'text'"><Icon name="note" :size="12" />Текст</button>
        <button class="tw:inline-flex tw:items-center tw:gap-4 tw:py-2 tw:px-8 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11px] tw:[&.on]:bg-warn/16 tw:[&.on]:text-warn-fg tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-[&.on]:bg-transparent tw:[.seg2_&]:[&.on]:bg-accent tw:[.seg2_&]:[&.on]:text-on-accent" :class="{ on: qtab === 'audio' }" @click="qtab = 'audio'"><Icon name="mic" :size="12" />Аудио</button>
        <button class="tw:inline-flex tw:items-center tw:gap-4 tw:py-2 tw:px-8 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11px] tw:[&.on]:bg-warn/16 tw:[&.on]:text-warn-fg tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-[&.on]:bg-transparent tw:[.seg2_&]:[&.on]:bg-accent tw:[.seg2_&]:[&.on]:text-on-accent" :class="{ on: qtab === 'event' }" @click="qtab = 'event'"><Icon name="plus" :size="12" />Событие</button>
        <button class="tw:inline-flex tw:items-center tw:gap-4 tw:py-2 tw:px-8 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11px] tw:[&.on]:bg-warn/16 tw:[&.on]:text-warn-fg tw:[&&&]:[&.hot]:[&:not(.on)]:text-(--call-mark-fg) tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-[&.on]:bg-transparent tw:[.seg2_&]:[&.on]:bg-accent tw:[.seg2_&]:[&.on]:text-on-accent" :class="{ on: qtab === 'call', hot: live.inCall }" @click="qtab = 'call'"><Icon name="phone" :size="12" />Звонок</button>
      </span>
      <!-- the orb opens the chats from now on (kept) -->
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:py-2 tw:px-8 tw:border tw:border-white/12 tw:rounded-full tw:bg-transparent tw:text-muted tw:text-[11px] tw:hover:text-text" title="Сфера открывает чаты: последние сообщения и ответ" @click="switchOrb('chat')"><Icon name="chat" :size="12" />Чат<b v-if="chat.unread.value" class="tw:min-w-15 tw:h-15 tw:px-3 tw:rounded-full tw:bg-accent tw:text-on-accent tw:text-[9.5px] tw:leading-15 tw:text-center">{{ chat.unread.value }}</b></button>
      <span v-if="noteTarget && qtab !== 'event'" class="ntarget tw:text-text tw:overflow-hidden tw:text-ellipsis tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">→ {{ noteTarget }}</span>
      <span class="spacer tw:flex-1 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"></span>
      <span v-if="qMsg" class="qmsg tw:min-w-0 tw:text-up-fg tw:text-[11px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ qMsg }}</span>
    </div>

    <template v-if="qtab === 'text'">
      <div class="qrow tw:flex-1 tw:flex tw:gap-8 tw:min-h-0">
        <textarea
          :ref="els.noteArea"
          v-model="note.text"
          class="ntext tw:flex-1 tw:resize-none tw:py-6 tw:px-8 tw:rounded-[4px] tw:border tw:border-warn/25 tw:bg-white/4 tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:font-[inherit] tw:[&&]:text-[12px] tw:[&&]:leading-[1.4] tw:outline-none tw:focus:border-warn/55"
          placeholder="Мысль, договорённость, ссылка… (Markdown)"
          spellcheck="false"
          @input="onNoteInput"
          @keydown.stop="onNoteKey"
        ></textarea>
        <div class="qside tw:flex-none tw:flex tw:flex-col tw:items-stretch tw:gap-6">
          <button class="qbtn tw:flex-none tw:inline-flex tw:items-center tw:gap-5 tw:py-5 tw:px-10 tw:rounded-[4px] tw:text-[12px] tw:self-stretch tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent" :disabled="!note.text.trim()" title="Сделать задачей" @click="quickToTask"><Icon name="checkSquare" :size="13" />В задачу</button>
        </div>
      </div>
    </template>

    <div v-else-if="qtab === 'audio'" class="qrec tw:flex-1 tw:flex tw:items-center tw:gap-12">
      <template v-if="recording?.kind === 'voice'">
        <button class="recbtn on tw:inline-flex tw:items-center tw:justify-center tw:w-44 tw:h-44 tw:rounded-[50%] tw:border tw:border-down/50 tw:bg-down tw:text-text-hi tw:animate-[Island-recpulse_1.2s_ease-in-out_infinite] tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-accent tw:[.seg2_&]:text-on-accent tw:hover:enabled:not-[.seg2_&]:border-border-3" title="Остановить и сохранить" @click="stopRec"><Icon name="stop" :size="14" /></button>
        <span class="meter tw:flex-1 tw:h-6 tw:rounded-r2 tw:bg-white/8 tw:overflow-hidden tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"><span class="tw:block tw:h-full tw:[background:linear-gradient(90deg,var(--up),var(--warn),var(--down))] tw:[transition:width_0.1s] tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :style="{ width: `${recLevel * 100}%` }"></span></span>
        <b class="rt tw:tabular-nums tw:font-data tw:text-[13px]">{{ fmtRec(recSec) }}</b>
      </template>
      <template v-else>
        <button class="recbtn tw:inline-flex tw:items-center tw:justify-center tw:w-44 tw:h-44 tw:rounded-[50%] tw:border tw:border-down/50 tw:bg-down/12 tw:text-down-fg tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent tw:hover:enabled:not-[.seg2_&]:bg-hover tw:hover:enabled:not-[.seg2_&]:border-border-3" :disabled="!!recording" title="Записать голосовую заметку" @click="startRec('voice')"><Icon name="mic" :size="16" /></button>
        <span class="muted small tw:text-[11px] tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ recording ? 'Идёт запись звонка' : 'Нажмите и говорите — расшифровка локально' }}</span>
      </template>
    </div>

    <div v-else-if="qtab === 'event'" class="qev tw:flex-1 tw:flex tw:flex-col tw:gap-6">
      <div class="qtop tw:flex tw:items-center tw:gap-8">
        <span class="qkinds tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">
          <button class="tw:py-3 tw:px-9 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11px] tw:[&.on]:text-text-hi tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent tw:[.seg2_&]:[&.on]:bg-accent tw:[.seg2_&]:[&.on]:text-on-accent" v-for="k in shownKinds" :key="k.id" :class="{ on: qKind === k.id }" :style="qKind === k.id ? { background: k.color } : {}" :title="k.label" @click="qKind = k.id">
            <Icon :name="k.icon" :size="13" />
          </button>
        </span>
        <OffsetField v-model="qOff" :max="240" class="qoff tw:flex-none tw:[.abar_&]:block tw:[.abar_&]:not-[&.compact]:h-full tw:[.abar_&]:rounded-r2" />
      </div>
      <div class="qrow tw:flex-1 tw:flex tw:gap-8 tw:min-h-0">
        <QuickField
          v-model="qLabel"
          class="qlabel tw:flex-1 tw:min-w-0"
          :day="today"
          :placeholder="`${kindLabel(qKind)} · 30м, 14:00-15:00, ABC-123, #вид · @ задача`"
          @keydown.stop
          @submit="addQuickEvent()"
          @kind="(k) => (qKind = k)"
          @task="(t) => (qTask = t)"
          @parsed="(p) => (qParsed = p)"
        />
        <DictateButton class="tw:[.seg2_&]:not-[&.on]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:not-[&.compact]:py-3 tw:[.seg2_&]:not-[&.compact]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-[&.on]:bg-transparent tw:[.seg2_&]:[&.on]:bg-accent tw:[&&]:[.seg2_&]:[&.on]:text-on-accent" compact @recorded="(r) => addQuickEvent(r)" />
        <button class="qbtn ok tw:flex-none tw:self-start tw:inline-flex tw:items-center tw:gap-5 tw:py-5 tw:px-10 tw:rounded-[4px] tw:text-[12px] tw:text-up tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent" @click="addQuickEvent()"><Icon name="check" :size="14" />Добавить</button>
      </div>
    </div>

    <div v-else class="qrec tw:flex-1 tw:flex tw:items-center tw:gap-12">
      <template v-if="recording?.kind === 'call'">
        <button class="recbtn on tw:inline-flex tw:items-center tw:justify-center tw:w-44 tw:h-44 tw:rounded-[50%] tw:border tw:border-down/50 tw:bg-down tw:text-text-hi tw:animate-[Island-recpulse_1.2s_ease-in-out_infinite] tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-accent tw:[.seg2_&]:text-on-accent tw:hover:enabled:not-[.seg2_&]:border-border-3" title="Остановить запись звонка" @click="stopRec"><Icon name="stop" :size="14" /></button>
        <span class="meter tw:flex-1 tw:h-6 tw:rounded-r2 tw:bg-white/8 tw:overflow-hidden tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"><span class="tw:block tw:h-full tw:[background:linear-gradient(90deg,var(--up),var(--warn),var(--down))] tw:[transition:width_0.1s] tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :style="{ width: `${recLevel * 100}%` }"></span></span>
        <b class="rt tw:tabular-nums tw:font-data tw:text-[13px]">{{ fmtRec(recSec) }}</b>
      </template>
      <template v-else>
        <button class="recbtn tw:inline-flex tw:items-center tw:justify-center tw:w-44 tw:h-44 tw:rounded-[50%] tw:border tw:border-down/50 tw:bg-down/12 tw:text-down-fg tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent tw:hover:enabled:not-[.seg2_&]:bg-hover tw:hover:enabled:not-[.seg2_&]:border-border-3" :disabled="!!recording" title="Записать звонок" @click="startRec('call')"><Icon name="phone" :size="15" /></button>
        <span class="muted small tw:text-[11px] tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ live.inCall ? 'Идёт созвон — записать звук собеседников и микрофон' : 'Запись звука компьютера и микрофона' }}. Предупредите участников о записи.</span>
      </template>
    </div>
  </div>
</template>

<style scoped src="./QuickNotePanel.css"></style>
