<script setup lang="ts">
/**
 * The harness's settings as fields (who reviews at the end, the limits, the plan shown first): the settings screen's
 * (a new chat's) and a chat's own (its menu) are the same fields. `change` — a field changed (the model is changed too).
 */
import { REVIEWER_OFF, REVIEWER_SELF, type HarnessSettings } from '@shared/agent/harness/constants'
import { agentProfiles } from '../../lib/agents'
import { SWITCH } from './switchClass'

const form = defineModel<HarnessSettings>({ required: true })
const emit = defineEmits<{ change: [] }>()
const LIMITS: Array<{ key: keyof HarnessSettings['limits']; label: string; title: string }> = [
  { key: 'iterations', label: 'Итераций', title: 'Ходов работы за запуск (каждое исправление — ещё один)' },
  { key: 'minutes', label: 'Минут', title: 'Время работы за запуск' },
  { key: 'sameFailure', label: 'Повторов ошибки', title: 'Одна и та же ошибка столько раз подряд — остановка: нужен другой подход' },
]
</script>

<template>
  <div class="tw:grid tw:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] tw:gap-12">
    <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">
      Финальная проверка
      <select v-model="form.reviewer" title="После всех пройденных проверок ИИ ещё раз сверяет работу с критериями плана" @change="emit('change')">
        <option :value="REVIEWER_OFF">нет — хватает проверок</option>
        <option :value="REVIEWER_SELF">тот же ИИ, что работал</option>
        <option v-for="p in agentProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </label>
    <label v-for="l in LIMITS" :key="l.key" class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted" :title="l.title">
      {{ l.label }}
      <input v-model.number="form.limits[l.key]" type="number" min="1" @change="emit('change')" />
    </label>
  </div>
  <label class="tw:flex tw:items-center tw:justify-between tw:gap-10 tw:max-w-420 tw:mt-8 tw:py-5 tw:text-text tw:text-[13px] tw:cursor-pointer">
    <span>Показывать план и ждать «Начать»</span>
    <input v-model="form.confirmPlan" :class="SWITCH" type="checkbox" @change="emit('change')" />
  </label>
</template>
