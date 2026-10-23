<script setup lang="ts">
/** Settings · general: idle → lunch, the call polling, autostart, call titles, key combos. */
import { useSettingsContext } from './settingsContext'

const { f } = useSettingsContext()
</script>

<template>
    <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
      <h3 class="tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Общее</h3>
      <div class="fields tw:grid tw:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] tw:gap-12">
        <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted" title="Обед ставится сам, если в обеденное время нет ввода столько минут">Обед после простоя, мин <input class="tw:[.secret_&]:flex-1" v-model.number="f.idleMin" type="number" min="1" max="60" /></label>
        <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted" title="Как часто проверяется, идёт ли созвон">Опрос созвонов, сек <input class="tw:[.secret_&]:flex-1" v-model.number="f.sampleSec" type="number" min="1" max="30" /></label>
        <label class="check tw:flex tw:flex-row tw:items-center tw:gap-8 tw:text-text tw:text-[13px]"><input class="tw:[.secret_&]:flex-1" v-model="f.autoStart" type="checkbox" /> Запускать вместе с Windows</label>
        <label class="check tw:flex tw:flex-row tw:items-center tw:gap-8 tw:text-text tw:text-[13px]" title="Берётся только заголовок окна программы созвона (Teams, Zoom…)">
          <input class="tw:[.secret_&]:flex-1" v-model="f.captureTitles" type="checkbox" /> Подписывать созвоны заголовком окна (с кем)
        </label>
        <label class="check tw:flex tw:flex-row tw:items-center tw:gap-8 tw:text-text tw:text-[13px]" title="Для счётчика комбо в мини-острове учитывается только сам факт нажатия">
          <input class="tw:[.secret_&]:flex-1" v-model="f.countKeys" type="checkbox" /> Считать комбо нажатий клавиш
        </label>
      </div>
    </section>
</template>
