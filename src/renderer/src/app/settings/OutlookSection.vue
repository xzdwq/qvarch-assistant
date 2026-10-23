<script setup lang="ts">
/** Settings · Outlook and Teams: the source (local Outlook / Microsoft Graph), sync and sign-in; applied at once. */
import { computed, reactive, ref } from 'vue'
import { useOutlook } from '../../lib/outlook'
import { remoteError } from '../../../../shared/remoteError'
import { useSettingsContext } from './settingsContext'

const { initial, apply } = useSettingsContext()
const ol = useOutlook()
const olForm = reactive({ ...initial.outlook })
const olBusy = ref(false)
const olError = ref('')
/** Outlook settings apply at once (no "Сохранить" needed). */
async function applyOutlook(): Promise<void> {
  await apply({ outlook: JSON.parse(JSON.stringify({ ...olForm, clientId: olForm.clientId?.trim() || undefined, tenantId: olForm.tenantId?.trim() || undefined })) })
}
/** Keeps the form, then signs in with Microsoft in the browser. */
async function outlookLogin(): Promise<void> {
  olError.value = ''
  olBusy.value = true
  try {
    await applyOutlook()
    await window.qa.outlookLogin()
  } catch (e) {
    olError.value = remoteError(e)
  } finally {
    olBusy.value = false
  }
}
const PRESENCE: Record<string, string> = {
  Available: 'В сети',
  Busy: 'Занят',
  DoNotDisturb: 'Не беспокоить',
  BeRightBack: 'Скоро вернусь',
  Away: 'Нет на месте',
  Offline: 'Не в сети',
  InACall: 'В звонке',
  InAConferenceCall: 'В конференции',
  InAMeeting: 'На собрании (по календарю)',
  Presenting: 'Демонстрирует экран',
}
const olSync = () => void window.qa.outlookSync()
const olLogout = () => void window.qa.outlookLogout()
const olSynced = computed(() => (ol.value.syncedAt ? new Date(ol.value.syncedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'))
</script>

<template>
    <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
      <h3 class="tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Outlook и Teams</h3>
      <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">
        Встречи из календаря Outlook становятся блоками «Встреча» (только чтение). Созвон остаётся отдельным блоком и связывается со встречей,
        если был во время неё — даже если начался раньше, позже или затянулся. Изменённый вами блок встречи синхронизация не трогает, удалённый — не возвращает.
      </p>
      <div class="srcseg tw:inline-flex tw:p-2 tw:mb-8 tw:rounded-[4px] tw:bg-white/5">
        <button class="tw:py-4 tw:px-12 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:bg-accent/22 tw:[&.on]:text-text tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" :class="{ on: olForm.source === 'local' }" @click="(olForm.source = 'local'), applyOutlook()">Outlook на этом компьютере</button>
        <button class="tw:py-4 tw:px-12 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:bg-accent/22 tw:[&.on]:text-text tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" :class="{ on: olForm.source === 'graph' }" @click="(olForm.source = 'graph'), applyOutlook()">Microsoft Graph</button>
      </div>
      <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">
        <template v-if="olForm.source === 'local'">Встречи берутся из запущенного классического Outlook — без Azure и согласий. Статус Teams так недоступен: созвон определяется по микрофону.</template>
        <template v-else>Нужна регистрация приложения в Azure и согласие (в вашей организации — администратора). Даёт ещё и статус Teams.</template>
      </p>
      <div class="fields tw:grid tw:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] tw:gap-12">
        <template v-if="olForm.source === 'graph'">
          <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">Client ID (приложение) <input class="tw:[.secret_&]:flex-1" v-model="olForm.clientId" spellcheck="false" @change="applyOutlook" /></label>
          <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">Tenant ID (каталог) <input class="tw:[.secret_&]:flex-1" v-model="olForm.tenantId" spellcheck="false" @change="applyOutlook" /></label>
        </template>
        <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">
          Синхронизация каждые
          <select v-model.number="olForm.syncMin" @change="applyOutlook">
            <option v-for="m in [5, 10, 15, 30, 60]" :key="m" :value="m">{{ m }} мин</option>
          </select>
        </label>
      </div>
      <div class="olopts tw:flex tw:flex-col tw:max-w-420 tw:mt-10">
        <label class="switch tw:flex-row tw:items-center tw:justify-between tw:gap-10 tw:py-5 tw:px-0 tw:text-text tw:text-[13px] tw:cursor-pointer tw:flex"><input class="tw:appearance-none tw:flex-none tw:relative tw:w-32 tw:h-18 tw:m-0 tw:rounded-[4px] tw:bg-white/14 tw:cursor-pointer tw:[transition:background_0.2s] tw:checked:bg-accent tw:[.secret_&]:flex-1 tw:after:content-[''] tw:after:absolute tw:after:top-2 tw:after:left-2 tw:after:w-14 tw:after:h-14 tw:after:rounded-[50%] tw:after:bg-text-hi tw:after:[transition:transform_0.2s_cubic-bezier(0.32,0.72,0,1)] tw:checked:after:[transform:translateX(14px)]" v-model="olForm.meetings" type="checkbox" @change="applyOutlook" /><span class="tw:-order-1">Встречи из календаря на таймлайн</span></label>
        <label v-if="olForm.source === 'graph'" class="switch tw:flex-row tw:items-center tw:justify-between tw:gap-10 tw:py-5 tw:px-0 tw:text-text tw:text-[13px] tw:cursor-pointer tw:flex" title="Статус «В звонке» в Teams"><input class="tw:appearance-none tw:flex-none tw:relative tw:w-32 tw:h-18 tw:m-0 tw:rounded-[4px] tw:bg-white/14 tw:cursor-pointer tw:[transition:background_0.2s] tw:checked:bg-accent tw:[.secret_&]:flex-1 tw:after:content-[''] tw:after:absolute tw:after:top-2 tw:after:left-2 tw:after:w-14 tw:after:h-14 tw:after:rounded-[50%] tw:after:bg-text-hi tw:after:[transition:transform_0.2s_cubic-bezier(0.32,0.72,0,1)] tw:checked:after:[transform:translateX(14px)]" v-model="olForm.presence" type="checkbox" @change="applyOutlook" /><span class="tw:-order-1">Статус Teams как признак созвона</span></label>
      </div>
      <div class="jrow tw:flex tw:items-center tw:gap-12 tw:flex-wrap tw:mt-12">
        <template v-if="ol.connected">
          <span class="ok tw:text-up-fg tw:text-[13px]">{{ ol.source === 'local' ? 'Источник' : 'Подключено' }}: {{ ol.account?.name }}<template v-if="ol.account?.email"> · {{ ol.account.email }}</template></span>
          <span class="muted small tw:text-[12px]">{{ ol.syncing ? 'синхронизация…' : `синхр. ${olSynced} · каждые ${olForm.syncMin} мин` }}</span>
          <span v-if="ol.presence" class="muted small tw:text-[12px]">Teams: {{ PRESENCE[ol.presence.activity] ?? PRESENCE[ol.presence.availability] ?? ol.presence.activity }}</span>
          <button class="tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" :disabled="ol.syncing" @click="olSync">Синхронизировать</button>
          <button class="tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" v-if="ol.source === 'graph'" @click="olLogout">Выйти</button>
        </template>
        <button v-else class="primary tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2 tw:hover:enabled:bg-accent-hi tw:[&&]:hover:enabled:border-accent-hi" :disabled="olBusy || !olForm.clientId || !olForm.tenantId" @click="outlookLogin">{{ olBusy ? 'Ждём вход в браузере…' : 'Войти через Microsoft' }}</button>
        <span v-if="olError || ol.error" class="err tw:text-down-fg tw:text-[13px]">{{ olError || ol.error }}</span>
      </div>
    </section>
</template>
