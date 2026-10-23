<script setup lang="ts">
/** A variable of one's own: name, a text or a JS formula. */
import { vFocusSelect as vFocus } from '../../lib/focusSelect'
import { useTermView } from './termViewContext'
import { BUILTIN_NAMES as BUILTIN } from './useVarEditor'

const { vEdit, vNew, vErr, saveVar } = useTermView().vars
/** «{{ … }}» as text (a mustache inside a mustache would close it). */
const INS = '{{ … }}'
const VAR_DATE = '{{ date }}'
</script>

<template>
      <div v-if="vEdit" class="tq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[12vh] tw:bg-black/55" @mousedown.self="vEdit = undefined">
        <form class="tq wide tw:flex tw:flex-col tw:gap-10 tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:w-[min(620px,calc(100vw-32px))]" @submit.prevent="saveVar" @keydown.esc="vEdit = undefined">
          <div class="cap">{{ vNew ? 'Новая переменная' : 'Переменная' }}</div>
          <label class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Имя (в пресетах — {{ INS }} с ним)<input class="tw:font-data tw:text-[12.5px]" v-model.trim="vEdit.name" v-focus spellcheck="false" placeholder="mainBranch" /></label>
          <div class="seg2 tw:inline-flex tw:self-start tw:border tw:border-border-2 tw:rounded-r2 tw:overflow-hidden">
            <button class="tw:py-4 tw:px-12 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg" type="button" :class="{ on: !vEdit.js }" @click="vEdit.js = false">Текст</button>
            <button class="tw:py-4 tw:px-12 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg" type="button" :class="{ on: vEdit.js }" @click="vEdit.js = true">Формула (JavaScript)</button>
          </div>
          <label class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">
            Значение
            <textarea class="tw:font-data tw:text-[12.5px] tw:resize-y" v-model="vEdit.value" rows="3" spellcheck="false" :placeholder="vEdit.js ? 'currentBranch.split(\'/\').pop()' : 'main'"></textarea>
          </label>
          <p class="hint tw:m-0 tw:text-muted tw:text-[11.5px]">
            <template v-if="vEdit.js">Формула считается заново при каждом нажатии пресета. В ней можно брать встроенные переменные и свои, что выше в списке. Пример: <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11px]">currentBranch.split('/').pop()</code> — из ветки feature/ABC-123 даст ABC-123.</template>
            <template v-else>Значение подставится как есть. Пример: <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11px]">main</code>. Внутри можно и подстановки: <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11px]">release/{{ VAR_DATE }}</code>.</template>
            <template v-if="BUILTIN.includes(vEdit.name)"> Внимание: имя совпадает со встроенной переменной — своя её заменит.</template>
          </p>
          <p v-if="vErr && vEdit.name" class="perr in tw:text-down-fg tw:text-[12px] tw:wrap-anywhere tw:m-0">{{ vErr }}</p>
          <div class="tqb tw:flex tw:gap-8"><button type="submit" class="primary" :disabled="!!vErr">Сохранить</button><button type="button" @click="vEdit = undefined">Отмена</button></div>
        </form>
      </div>
</template>
