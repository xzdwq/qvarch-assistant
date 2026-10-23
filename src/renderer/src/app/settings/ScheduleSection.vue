<script setup lang="ts">
/** Settings · the work schedule: the official hours and work days (only a guide for the timeline). */
import { useSettingsContext } from './settingsContext'

const { f } = useSettingsContext()
const DAYS = [
  { id: 1, label: 'Пн' },
  { id: 2, label: 'Вт' },
  { id: 3, label: 'Ср' },
  { id: 4, label: 'Чт' },
  { id: 5, label: 'Пт' },
  { id: 6, label: 'Сб' },
  { id: 0, label: 'Вс' },
]

/** A weekday in or out of the work days. */
function toggleDay(id: number): void {
  const set = new Set(f.schedule.workDays)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  f.schedule.workDays = [...set]
}
</script>

<template>
    <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
      <h3 class="tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Рабочий график</h3>
      <p class="muted tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0">Официальное время — только ориентир для таймлайна. Трекинг идёт всегда, когда QA включено.</p>
      <div class="fields tw:grid tw:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] tw:gap-12">
        <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">Начало <input class="tw:[.secret_&]:flex-1" v-model="f.schedule.start" type="time" /></label>
        <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">Конец <input class="tw:[.secret_&]:flex-1" v-model="f.schedule.end" type="time" /></label>
        <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">Обед с <input class="tw:[.secret_&]:flex-1" v-model="f.schedule.lunchStart" type="time" /></label>
        <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">Обед до <input class="tw:[.secret_&]:flex-1" v-model="f.schedule.lunchEnd" type="time" /></label>
      </div>
      <div class="days tw:flex tw:flex-wrap tw:gap-6 tw:mt-12">
        <button v-for="d in DAYS" :key="d.id" class="chip tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" :class="{ on: f.schedule.workDays.includes(d.id) }" :style="f.schedule.workDays.includes(d.id) ? { background: 'var(--accent)' } : {}" @click="toggleDay(d.id)">
          {{ d.label }}
        </button>
      </div>
      <label class="tw:flex tw:items-center tw:gap-8 tw:mt-12 tw:text-[12.5px]" title="Запись, начатая до конца рабочего дня, останавливается в его конце; начатая после — идёт, пока её не остановят">
        <input type="checkbox" :checked="f.schedule.stopRecordingAtEnd !== false" @change="f.schedule.stopRecordingAtEnd = ($event.target as HTMLInputElement).checked" />
        «Запись» останавливается в конце рабочего дня
      </label>
    </section>
</template>
