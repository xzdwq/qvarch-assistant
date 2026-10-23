<script setup lang="ts">
/** A reaction: name, words / regexes, case and whole word, its colour; tried on a test line. */
import { WATCH_COLOR_VARS } from '@shared/terminal'
import { cssHex } from '../../lib/cssColor'
import { useTermView } from './termViewContext'

const { wEdit, wNew, wTest, wErr, wTestHit, saveWatch } = useTermView().watches
/** The offered colours: shown by their variable, kept in the reaction as the concrete colour. */
const swatches = WATCH_COLOR_VARS.map((cssVar) => ({ cssVar, color: cssHex(cssVar) ?? '' }))
</script>

<template>
      <div v-if="wEdit" class="tq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[12vh] tw:bg-black/55" @mousedown.self="wEdit = undefined">
        <form class="tq wide tw:flex tw:flex-col tw:gap-10 tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:w-[min(620px,calc(100vw-32px))]" @submit.prevent="saveWatch" @keydown.esc="wEdit = undefined">
          <div class="cap">{{ wNew ? 'Новая реакция' : 'Реакция' }}</div>
          <label class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Название<input class="tw:font-data tw:text-[12.5px]" v-model="wEdit.name" spellcheck="false" placeholder="Ошибки" /></label>
          <label class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">
            Слова — по одному в строке; регулярка — /…/
            <textarea class="tw:font-data tw:text-[12.5px] tw:resize-y" v-model="wEdit.patterns" rows="4" spellcheck="false" placeholder="error&#10;failed&#10;/\bE\d{3,}\b/"></textarea>
          </label>
          <div class="wopts tw:flex tw:gap-18">
            <label class="tqc tw:flex tw:items-center tw:gap-8 tw:text-text-2 tw:text-[12.5px]"><input v-model="wEdit.ignoreCase" type="checkbox" />Без учёта регистра</label>
            <label class="tqc tw:flex tw:items-center tw:gap-8 tw:text-text-2 tw:text-[12.5px]"><input v-model="wEdit.word" type="checkbox" />Только слово целиком</label>
          </div>
          <div class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">
            Цвет (им мигает TERMINAL внизу)
            <div class="sw tw:flex tw:items-center tw:gap-6">
              <button class="tw:w-20 tw:h-20 tw:p-0 tw:border-0 tw:rounded-[3px] tw:[&.on]:[box-shadow:0_0_0_2px_var(--panel),0_0_0_3.5px_var(--text-hi)]" v-for="s in swatches" :key="s.cssVar" type="button" :class="{ on: wEdit.color === s.color }" :style="{ background: `var(${s.cssVar})` }" :title="s.color" @click="wEdit.color = s.color"></button>
              <input class="tw:font-data tw:text-[12.5px] tw:w-28 tw:h-22 tw:p-0 tw:border-0 tw:bg-transparent" v-model="wEdit.color" type="color" title="Свой цвет" />
            </div>
          </div>
          <label class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">
            Проверить на строке
            <input class="tw:font-data tw:text-[12.5px]" v-model="wTest" spellcheck="false" placeholder="npm ERR! code ELIFECYCLE" />
          </label>
          <p v-if="wErr" class="perr in tw:text-down-fg tw:text-[12px] tw:wrap-anywhere tw:m-0">{{ wErr }}</p>
          <p v-else-if="wTestHit !== undefined" class="hint tw:m-0 tw:text-muted tw:text-[11.5px] tw:[&.ok]:text-up-fg" :class="wTestHit ? 'ok' : ''">{{ wTestHit ? `Сработает: «${wTestHit}»` : 'Не сработает' }}</p>
          <div class="tqb tw:flex tw:gap-8"><button type="submit" class="primary" :disabled="!!wErr">Сохранить</button><button type="button" @click="wEdit = undefined">Отмена</button></div>
        </form>
      </div>
</template>
