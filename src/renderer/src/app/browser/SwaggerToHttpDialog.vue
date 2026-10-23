<script setup lang="ts">
import { useBrowserView } from './browserViewContext'

/** The picked Swagger operations into the HTTP section (teleported): how their requests are filled in. */
const { api, apiPicked, apiOpts, apiAsk, apiToHttp } = useBrowserView().swagger
</script>

<template>
  <div v-if="apiAsk && api" class="bq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[10vh] tw:bg-black/55" @mousedown.self="apiAsk = false">
    <form class="bq tw:flex tw:flex-col tw:gap-10 tw:w-[min(440px,calc(100vw-32px))] tw:max-h-[80vh] tw:overflow-auto tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)]" @submit.prevent="apiToHttp" @keydown.esc="apiAsk = false">
      <div class="cap tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">В HTTP: {{ api.info.title }} · запросов: {{ apiPicked.size }}</div>
      <label class="tqc tw:flex tw:items-center tw:gap-8 tw:text-text-2 tw:text-[12.5px]"><input v-model="apiOpts.defaults" type="checkbox" />Заполнить значениями из описания — default, example, первый вариант enum (в параметрах, пути и теле)</label>
      <label class="tqc tw:flex tw:items-center tw:gap-8 tw:text-text-2 tw:text-[12.5px]"><input v-model="apiOpts.optional" type="checkbox" />Включить и необязательные параметры (иначе — только обязательные)</label>
      <p class="hint tw:m-0 tw:text-muted tw:text-[11.5px]">Где описание ничего не предлагает, останется пусто: строка — "", число — 0, false, [].</p>
      <div class="tqb tw:flex tw:gap-8"><button type="submit" class="primary">Создать в HTTP</button><button type="button" @click="apiAsk = false">Отмена</button></div>
    </form>
  </div>
</template>
