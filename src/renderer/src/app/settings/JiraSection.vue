<script setup lang="ts">
/** Settings · Jira: one's own Atlassian app (client id, secret, projects), the sync interval and sign-in. */
import { ref } from 'vue'
import { useJira } from '../../lib/jira'
import { remoteError } from '../../../../shared/remoteError'
import { useSettingsContext } from './settingsContext'

const { f, save, apply } = useSettingsContext()
const jira = useJira()
const jiraBusy = ref(false)
const jiraError = ref('')
const jiraSync = () => void window.qa.jiraSync()
const jiraLogout = () => void window.qa.jiraLogout()
/** Save the form (client id / secret / projects), then sign in in the browser. */
async function jiraLogin(): Promise<void> {
  jiraError.value = ''
  jiraBusy.value = true
  try {
    await save()
    await window.qa.jiraLogin()
  } catch (e) {
    jiraError.value = remoteError(e)
  } finally {
    jiraBusy.value = false
  }
}
/** The sync interval applies at once. */
async function applyJiraEvery(): Promise<void> {
  await apply({ jira: { syncMin: f.jiraSyncMin } })
}
</script>

<template>
    <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
      <h3 class="tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Jira</h3>
      <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Своё приложение Atlassian (OAuth 2.0): developer.atlassian.com → ваше приложение → Settings. Callback: <code class="tw:text-[12px] tw:text-accent-fg tw:bg-panel-2 tw:py-1 tw:px-5 tw:rounded-r2">http://localhost:47321/callback</code>. Секрет хранится зашифрованным на этом компьютере.</p>
      <div class="fields tw:grid tw:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] tw:gap-12">
        <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">Client ID <input class="tw:[.secret_&]:flex-1" v-model="f.jiraClientId" spellcheck="false" placeholder="из Settings приложения" /></label>
        <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">Secret <input class="tw:[.secret_&]:flex-1" v-model="f.jiraSecret" type="password" spellcheck="false" :placeholder="jira.hasSecret ? 'сохранён — введите, чтобы заменить' : 'Client secret'" /></label>
        <label class="span2 tw:col-span-full tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">Проекты (ключи или ссылки на доски) <input class="tw:[.secret_&]:flex-1" v-model="f.jiraProjects" spellcheck="false" placeholder="ABC, XYZ" /></label>
        <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">
          Синхронизация каждые
          <select v-model.number="f.jiraSyncMin" @change="applyJiraEvery">
            <option v-for="m in [5, 10, 15, 30, 60]" :key="m" :value="m">{{ m }} мин</option>
          </select>
        </label>
      </div>
      <div class="jrow tw:flex tw:items-center tw:gap-12 tw:flex-wrap tw:mt-12">
        <template v-if="jira.connected">
          <span class="ok tw:text-up-fg tw:text-[13px]">Подключено: {{ jira.account?.name }} · {{ jira.siteUrl }}</span>
          <span class="muted small tw:text-[12px]">{{ jira.issues.length }} задач · синхр. каждые {{ f.jiraSyncMin }} мин</span>
          <button class="tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" :disabled="jira.syncing" @click="jiraSync">{{ jira.syncing ? 'Синхронизация…' : 'Синхронизировать' }}</button>
          <button class="tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" @click="jiraLogout">Выйти</button>
        </template>
        <button v-else class="primary tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2 tw:hover:enabled:bg-accent-hi tw:[&&]:hover:enabled:border-accent-hi" :disabled="jiraBusy" @click="jiraLogin">{{ jiraBusy ? 'Ждём вход в браузере…' : 'Войти через Atlassian' }}</button>
        <span v-if="jiraError || jira.error" class="err tw:text-down-fg tw:text-[13px]">{{ jiraError || jira.error }}</span>
      </div>
    </section>
</template>
