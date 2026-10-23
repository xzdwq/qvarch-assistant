<script setup lang="ts">
/** A preset: name, command (with {{ js }} inserts), run at once or only type in. */
import { useTermView } from './termViewContext'

const { editing, isNew, saveEdit } = useTermView().presets
/** «{{ … }}» as text (a mustache inside a mustache would close it). */
const INS = '{{ … }}'
</script>

<template>
      <div v-if="editing" class="tq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[12vh] tw:bg-black/55" @mousedown.self="editing = undefined">
        <form class="tq wide tw:flex tw:flex-col tw:gap-10 tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:w-[min(620px,calc(100vw-32px))]" @submit.prevent="saveEdit" @keydown.esc="editing = undefined">
          <div class="cap">{{ isNew ? 'Новый пресет' : 'Пресет' }}</div>
          <label class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Название<input class="tw:font-data tw:text-[12.5px]" v-model="editing.name" spellcheck="false" placeholder="Коммит с задачей" /></label>
          <label class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Команда<textarea class="tw:font-data tw:text-[12.5px] tw:resize-y" v-model="editing.cmd" rows="4" spellcheck="false" placeholder="git commit -m &quot;[{{ task }}] &quot;"></textarea></label>
          <label class="tqc tw:flex tw:items-center tw:gap-8 tw:text-text-2 tw:text-[12.5px]"><input v-model="editing.run" type="checkbox" />Сразу выполнить (иначе — только вписать, чтобы дописать руками)</label>
          <p class="hint tw:m-0 tw:text-muted tw:text-[11.5px]">{{ INS }} — JavaScript: currentBranch, task, cwd, dir, date, свои переменные, ask('Вопрос'), sh('команда')… — подробно в «Инструкции».</p>
          <div class="tqb tw:flex tw:gap-8"><button type="submit" class="primary" :disabled="!editing.cmd.trim()">Сохранить</button><button type="button" @click="editing = undefined">Отмена</button></div>
        </form>
      </div>
</template>
