<script setup lang="ts">
/** A preset's ask(…) questions, answered before it runs. */
import { useTermView } from './termViewContext'

const { asking, submitAsk } = useTermView().runner
</script>

<template>
      <div v-if="asking" class="tq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[12vh] tw:bg-black/55" @mousedown.self="asking = undefined">
        <form class="tq tw:flex tw:flex-col tw:gap-10 tw:w-[min(440px,calc(100vw-32px))] tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)]" @submit.prevent="submitAsk" @keydown.esc="asking = undefined">
          <div class="cap">{{ asking.preset.name }}</div>
          <label v-for="(f, i) in asking.fields" :key="f.label" class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">{{ f.label }}<input class="tw:font-data tw:text-[12.5px]" v-model="f.value" :autofocus="i === 0" spellcheck="false" /></label>
          <div class="tqb tw:flex tw:gap-8"><button type="submit" class="primary">{{ asking.preset.run ? 'Выполнить' : 'Вставить' }}</button><button type="button" @click="asking = undefined">Отмена</button></div>
        </form>
      </div>
</template>
