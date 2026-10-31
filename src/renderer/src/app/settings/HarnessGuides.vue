<script setup lang="ts">
/**
 * Settings · harness · the instructions for kinds of tasks: each — its title and the few words the agent chooses it
 * by, turned on or off; edited in place (its text), added, deleted; a built-in one edited — back to the app's text.
 */
import { reactive, ref } from 'vue'
import { GUIDE_BODY_MAX, GUIDE_SUMMARY_MAX, GUIDE_TITLE_MAX, guideIdOf, type HarnessGuide } from '@shared/agent/harness/guides'
import { remoteError } from '@shared/remoteError'
import Icon from '../../components/Icon.vue'
import { harnessGuides, loadGuides, removeGuide, resetGuide, saveGuide } from '../../lib/harness/harnessDriver'
import { SWITCH } from './switchClass'

void loadGuides().catch(() => undefined)
const editing = ref<string>()
const draft = reactive({ id: '', title: '', summary: '', body: '' })
const isNew = ref(false)
const error = ref('')
function edit(g: HarnessGuide): void {
  Object.assign(draft, { id: g.id, title: g.title, summary: g.summary, body: g.body })
  isNew.value = false
  editing.value = g.id
  error.value = ''
}
function add(): void {
  Object.assign(draft, { id: '', title: '', summary: '', body: '' })
  isNew.value = true
  editing.value = ''
  error.value = ''
}
const was = (id: string) => harnessGuides.value.find((g) => g.id === id)
async function attempt(fn: () => Promise<void>): Promise<void> {
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = remoteError(e)
  }
}
const save = () =>
  attempt(async () => {
    const id = isNew.value ? guideIdOf(draft.title, new Set(harnessGuides.value.map((g) => g.id))) : draft.id
    const old = was(id)
    await saveGuide({ id, title: draft.title, summary: draft.summary, body: draft.body, enabled: old?.enabled ?? true, origin: old?.origin ?? 'user', edited: old?.edited ?? false })
    editing.value = undefined
  })
const toggle = (g: HarnessGuide) => attempt(() => saveGuide({ ...g, enabled: !g.enabled }))
const drop = (g: HarnessGuide) => attempt(() => removeGuide(g.id))
const reset = (g: HarnessGuide) => attempt(() => resetGuide(g.id))
const btn = 'tw:inline-flex tw:flex-none tw:w-26 tw:h-26 tw:p-0 tw:items-center tw:justify-center'
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-6 tw:mt-14">
    <div class="tw:flex tw:items-center tw:gap-8">
      <b class="tw:text-[12.5px]">Инструкции по видам задач</b>
      <span class="tw:min-w-0 tw:truncate tw:text-muted tw:text-[12px]">ИИ видит название и краткое описание, читает только подходящие задаче</span>
    </div>
    <template v-for="g in harnessGuides" :key="g.id">
      <div v-if="editing === g.id" class="tw:flex tw:flex-col tw:gap-6 tw:p-8 tw:border tw:border-accent/50 tw:rounded-r2">
        <input v-model="draft.title" :maxlength="GUIDE_TITLE_MAX" placeholder="Название" />
        <input v-model="draft.summary" :maxlength="GUIDE_SUMMARY_MAX" placeholder="Для каких задач — несколько слов (по ним ИИ выбирает)" />
        <textarea v-model="draft.body" :maxlength="GUIDE_BODY_MAX" rows="12" class="tw:font-data tw:text-[12px] tw:resize-y" placeholder="Текст инструкции"></textarea>
        <div class="tw:flex tw:items-center tw:gap-6">
          <button class="tw:h-28 tw:px-12" @click="save">Сохранить</button>
          <button class="tw:h-28 tw:px-12" @click="editing = undefined">Отмена</button>
          <span class="tw:text-muted tw:text-[11.5px]">id: {{ g.id }}</span>
        </div>
      </div>
      <div v-else class="tw:flex tw:items-center tw:gap-8 tw:min-h-32 tw:px-8 tw:border tw:border-border tw:rounded-r2 tw:whitespace-nowrap" :class="{ 'tw:opacity-55': !g.enabled }">
        <input :checked="g.enabled" :class="SWITCH" type="checkbox" :title="g.enabled ? 'Выключить — ИИ не будет её видеть' : 'Включить'" @change="toggle(g)" />
        <b class="tw:flex-none tw:text-[12.5px]">{{ g.title }}</b>
        <span class="tw:min-w-0 tw:truncate tw:text-muted tw:text-[12px]" :title="g.summary">{{ g.summary }}</span>
        <span class="tw:flex-1"></span>
        <span v-if="g.origin === 'builtin'" class="tw:flex-none tw:text-dim tw:text-[11px]">{{ g.edited ? 'встроенная, изменена' : 'встроенная' }}</span>
        <button v-if="g.origin === 'builtin' && g.edited" :class="btn" title="Вернуть текст приложения (и его обновления)" @click="reset(g)"><Icon name="undo" :size="12" /></button>
        <button :class="btn" title="Изменить" @click="edit(g)"><Icon name="pencil" :size="12" /></button>
        <button :class="btn" title="Удалить" @click="drop(g)"><Icon name="trash" :size="12" /></button>
      </div>
    </template>
    <div v-if="editing === ''" class="tw:flex tw:flex-col tw:gap-6 tw:p-8 tw:border tw:border-accent/50 tw:rounded-r2">
      <input v-model="draft.title" :maxlength="GUIDE_TITLE_MAX" placeholder="Название (латиницей в нём не обязательно)" />
      <input v-model="draft.summary" :maxlength="GUIDE_SUMMARY_MAX" placeholder="Для каких задач — несколько слов (по ним ИИ выбирает)" />
      <textarea v-model="draft.body" :maxlength="GUIDE_BODY_MAX" rows="12" class="tw:font-data tw:text-[12px] tw:resize-y" placeholder="Текст инструкции"></textarea>
      <div class="tw:flex tw:items-center tw:gap-6">
        <button class="tw:h-28 tw:px-12" @click="save">Добавить</button>
        <button class="tw:h-28 tw:px-12" @click="editing = undefined">Отмена</button>
      </div>
    </div>
    <button v-if="editing === undefined" class="tw:self-start tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-12" @click="add"><Icon name="plus" :size="12" />Добавить инструкцию</button>
    <span v-if="error" class="tw:text-down-fg tw:text-[12px]">{{ error }}</span>
  </div>
</template>
