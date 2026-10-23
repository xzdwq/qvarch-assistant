<script setup lang="ts">
import KindMenu from '../../components/KindMenu.vue'
import Icon from '../../components/Icon.vue'
import { useCalendarState } from './useTaskCalendar'

/** The right-click menu of the strip (see useCalendarMenu). */
const { cmenu, formatHM, onMenuKind, menuOpen, menuNote, menuDelete } = useCalendarState()
</script>

<template>
  <KindMenu
    v-if="cmenu"
    :x="cmenu.x"
    :y="cmenu.y"
    :title="cmenu.entry ? (cmenu.entry.outlook ? 'Встреча из Outlook' : 'Изменить вид') : `Новое событие · ${formatHM(cmenu.t)}`"
    :current="cmenu.entry?.kind"
    :no-kinds="!!cmenu.entry?.outlook"
    @pick="onMenuKind"
    @close="cmenu = undefined"
  >
    <p v-if="cmenu.entry?.outlook" class="cm-note tw:max-w-230 tw:mt-0 tw:mr-6 tw:mb-6 tw:ml-6 tw:text-muted tw:text-[11.5px] tw:leading-[1.4]">Время, название и вид меняет только Outlook. Напоминание и связи — в карточке.</p>
    <div class="cm-sep tw:h-1 tw:my-4 tw:mx-6 tw:bg-border"></div>
    <template v-if="cmenu.entry">
      <button class="cm-act tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[13px] tw:text-left tw:hover:bg-white/7 tw:hover:enabled:border-border-3" @click="menuOpen"><Icon name="pencil" :size="14" />Открыть</button>
      <button v-if="!cmenu.entry.outlook" class="cm-act del tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-[13px] tw:text-left tw:hover:bg-white/7 tw:text-down-fg tw:hover:enabled:border-border-3" @click="menuDelete"><Icon name="trash" :size="14" />{{ cmenu.entry.series ? 'Удалить…' : 'Удалить' }}</button>
    </template>
    <button v-else class="cm-act tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[13px] tw:text-left tw:hover:bg-white/7 tw:hover:enabled:border-border-3" @click="menuNote"><Icon name="note" :size="14" />Заметка здесь</button>
  </KindMenu>
</template>
