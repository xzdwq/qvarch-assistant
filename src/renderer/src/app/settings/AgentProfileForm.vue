<script setup lang="ts">
/**
 * One AI agent's settings: its name in the chats, the provider and model it runs on, its key (kept encrypted, never
 * shown back), what it is told, the folders it searches, a project it may read (Claude Code), where it makes its work.
 * «Проверить» — the models the provider offers (the connection and the key checked).
 */
import { computed, reactive, ref } from 'vue'
import { AGENT_PROVIDER_IDS, AGENT_PROVIDERS } from '@shared/agent/providers'
import { INSTRUCTIONS_MAX, type AgentProfile, type AgentProfileView } from '@shared/agent/profiles'
import { remoteError } from '@shared/remoteError'
import SuggestInput from '../../components/SuggestInput.vue'
import { saveAgent } from '../../lib/agents'

const props = defineProps<{ profile: AgentProfileView }>()
const emit = defineEmits<{ done: [] }>()
const form = reactive<AgentProfile>({ ...props.profile, folders: [...props.profile.folders] })
const folders = ref(props.profile.folders.join(', '))
const key = ref('')
const models = ref<string[]>([])
const status = ref('')
const error = ref('')
const busy = ref(false)
const provider = computed(() => AGENT_PROVIDERS[form.provider])
/** An agent harness elsewhere: its own tools and loop — its session and headers asked, not where it works. */
const harness = computed(() => provider.value.protocol === 'harness')
const field ='tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted'

/** Saved; the key — only when typed (empty — the kept one stays). */
async function save(): Promise<boolean> {
  error.value = ''
  try {
    await saveAgent({ ...form, folders: folders.value.split(',').map((f) => f.trim()).filter(Boolean) }, key.value.trim() || undefined)
    key.value = ''
    return true
  } catch (e) {
    error.value = remoteError(e)
    return false
  }
}
async function check(): Promise<void> {
  busy.value = true
  status.value = ''
  try {
    if (!(await save())) return
    models.value = await window.qa.agentModels(form.id)
    status.value = models.value.length ? `Связь есть · моделей: ${models.value.length}` : 'Связь есть'
  } catch (e) {
    error.value = remoteError(e)
  } finally {
    busy.value = false
  }
}
async function saveAndClose(): Promise<void> {
  if (await save()) emit('done')
}
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-10 tw:p-12 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel-2">
    <div class="tw:grid tw:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] tw:gap-12">
      <label :class="field">Имя в чатах<input v-model="form.name" maxlength="60" /></label>
      <label :class="field">
        Провайдер
        <select v-model="form.provider">
          <option v-for="id in AGENT_PROVIDER_IDS" :key="id" :value="id">{{ AGENT_PROVIDERS[id].title }}</option>
        </select>
      </label>
      <label :class="field">
        Модель
        <SuggestInput v-model="form.model" :options="models" :placeholder="provider.model ?? (form.provider === 'claude-code' ? 'как в Claude Code' : harness ? 'как настроен агент' : 'выберите после «Проверить»')" />
      </label>
      <label v-if="form.provider !== 'claude-code'" :class="field">Адрес<input v-model="form.baseUrl" :placeholder="provider.baseUrl ?? 'http://…/v1'" /></label>
      <label v-if="provider.key !== 'none'" :class="field">
        Ключ
        <input v-model="key" type="password" autocomplete="off" :placeholder="profile.hasKey ? 'сохранён — введите, чтобы заменить' : provider.key === 'required' ? 'нужен' : 'если сервер просит'" />
      </label>
      <label v-if="form.provider === 'claude-code'" :class="field">Папка проекта (только чтение)<input v-model="form.project" placeholder="C:\…\project" /></label>
      <label :class="field">Папки базы знаний<input v-model="folders" placeholder="все заметки; или через запятую" /></label>
      <label v-if="!harness" :class="field">Папка для работ ИИ<input v-model="form.workRoot" placeholder="корень блокнота" /></label>
      <label v-if="harness" :class="field" title="Заголовок, по которому агент помнит разговор; у каждого чата свой. «-» — без сессии">
        Заголовок сессии
        <input v-model="form.sessionHeader" :placeholder="provider.sessionHeader ?? 'нет — каждый ход отдельно'" />
      </label>
    </div>
    <label v-if="harness" :class="field">
      Дополнительные заголовки (по строке «Имя: значение»)
      <textarea v-model="form.headers" rows="2" maxlength="2000" placeholder="X-Profile: default" />
    </label>
    <label :class="field">
      Указания (роль, манера, что важно)
      <textarea v-model="form.instructions" rows="4" :maxlength="INSTRUCTIONS_MAX" placeholder="Например: ты аналитик, отвечай со ссылками на требования" />
    </label>
    <p class="tw:m-0 tw:text-muted tw:text-[12px]">{{ provider.hint }}</p>
    <div class="tw:flex tw:items-center tw:gap-8">
      <button class="primary tw:h-28 tw:py-0 tw:px-12" @click="saveAndClose">Сохранить</button>
      <button class="tw:h-28 tw:py-0 tw:px-12" :disabled="busy" @click="check">{{ busy ? 'Проверяю…' : 'Проверить' }}</button>
      <button class="tw:h-28 tw:py-0 tw:px-12" @click="emit('done')">Отмена</button>
      <span v-if="status" class="tw:text-up-fg tw:text-[12px]">{{ status }}</span>
      <span v-if="error" class="tw:min-w-0 tw:text-down-fg tw:text-[12px]">{{ error }}</span>
    </div>
  </div>
</template>
