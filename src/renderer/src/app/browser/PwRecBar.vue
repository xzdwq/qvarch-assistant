<script setup lang="ts">
import { pwRec, stopPwRec } from '../../lib/pwrec'

/** A Playwright scenario being recorded: where its lines go, how many, the last one; cancelled or stopped. */
</script>

<template>
  <div v-if="pwRec" class="pwrecbar tw:flex-none tw:flex tw:items-center tw:gap-10 tw:min-w-0 tw:py-6 tw:px-12 tw:border-b tw:border-b-stop/50 tw:bg-stop/12 tw:text-[12.5px] tw:whitespace-nowrap">
    <i class="prd tw:w-10 tw:h-10 tw:rounded-[50%] tw:bg-stop tw:animate-[BrowserView-prblink_1.2s_ease-in-out_infinite] tw:[.hsw_input:checked+&]:bg-accent tw:[.hsw_input:checked+&]:after:[transform:translateX(12px)] tw:[.hsw_input:checked+&]:after:bg-white"></i><b class="">Запись сценария Playwright</b>
    <span class="pmuted tw:text-muted">{{ pwRec.key === 'check:steps' ? 'шаги для журнала' : `в «${pwRec.note.split('/').pop()!.replace(/\.md$/i, '')}»` }} · строк: {{ pwRec.count }}</span>
    <code v-if="pwRec.last" class="plast tw:min-w-0 tw:overflow-hidden tw:text-text-2 tw:font-data tw:text-[11.5px] tw:text-ellipsis" :title="pwRec.last">{{ pwRec.last }}</code>
    <span class="pgrow tw:flex-1"></span>
    <button class="tw:inline-flex tw:flex-none tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text" title="Остановить и ничего не вставлять" @click="stopPwRec(true)">Отменить</button>
    <button class="ppri tw:inline-flex tw:flex-none tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:[&&]:border-stop tw:bg-stop tw:text-white" :title="pwRec.key === 'check:steps' ? 'Остановить — шаги встанут в запись журнала (Проверка)' : 'Остановить — записанное встанет в блок теста, заметка откроется'" @click="stopPwRec()"><i class="psq tw:w-9 tw:h-9 tw:rounded-[2px] tw:bg-white tw:[.hsw_input:checked+&]:bg-accent tw:[.hsw_input:checked+&]:after:[transform:translateX(12px)] tw:[.hsw_input:checked+&]:after:bg-white"></i>{{ pwRec.key === 'check:steps' ? 'Стоп — в журнал' : 'Стоп — в заметку' }}</button>
  </div>
</template>
