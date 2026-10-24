<script setup lang="ts">
/** Settings · the transport server: address, name, access code, the connection's state; applied at once. */
import { computed, reactive, ref } from 'vue'
import { remoteError } from '@shared/remoteError'
import { fingerprint, useTransport } from '../../lib/transport'
import { useSettingsContext } from './settingsContext'
import { SWITCH } from './switchClass'

const { initial, apply } = useSettingsContext()
const t = useTransport()
const form = reactive({ ...initial.transport })
const code = ref('')
const error = ref('')

async function applyTransport(): Promise<void> {
  await apply({ transport: { ...form } })
}
/** The access code kept encrypted ('' — taken away); the connection is made anew with it. */
async function saveCode(value: string): Promise<void> {
  error.value = ''
  try {
    await window.qa.transportSetCode(value)
    code.value = ''
  } catch (e) {
    error.value = remoteError(e)
  }
}
const reconnect = () => void window.qa.transportReconnect()

const STATUS_TEXT = { off: 'Не подключено', connecting: 'Подключение…', online: 'Подключено', error: 'Нет связи' } as const
const statusLine = computed(() => {
  const s = t.value
  if (s.status !== 'online') return STATUS_TEXT[s.status]
  return [STATUS_TEXT.online, s.server && `сервер ${s.server}`, s.name && `вы — ${s.name}`].filter(Boolean).join(' · ')
})
</script>

<template>
  <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
    <h3 class="tw:mt-0 tw:mb-8 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Сервер</h3>
    <p class="muted small tw:mt-0 tw:mb-12 tw:text-[12px]">
      Связь с другими копиями приложения: чат, а дальше — совместная работа. Учётных записей нет: устройство узнаётся по своему ключу, созданному при первом запуске,
      имя каждый задаёт себе сам.
    </p>
    <label class="tw:flex tw:items-center tw:justify-between tw:gap-10 tw:max-w-420 tw:py-5 tw:text-text tw:text-[13px] tw:cursor-pointer">
      <span>Подключаться к серверу</span>
      <input v-model="form.enabled" :class="SWITCH" type="checkbox" @change="applyTransport" />
    </label>
    <div class="tw:grid tw:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] tw:gap-12 tw:mt-8">
      <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">
        Адрес сервера
        <input v-model.trim="form.url" spellcheck="false" placeholder="host:3000 или wss://…" @change="applyTransport" />
      </label>
      <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">
        Ваше имя
        <input v-model.trim="form.name" spellcheck="false" maxlength="60" placeholder="Как вас видят другие" @change="applyTransport" />
      </label>
      <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">
        Код доступа {{ t.hasCode ? '(задан)' : '(не задан)' }}
        <span class="tw:flex tw:gap-6">
          <input v-model="code" class="tw:flex-1 tw:min-w-0" type="password" autocomplete="off" :placeholder="t.hasCode ? 'Новый код' : 'Если сервер его требует'" @keydown.enter="saveCode(code)" />
          <button :disabled="!code" @click="saveCode(code)">Сохранить</button>
          <button v-if="t.hasCode" title="Забыть код" @click="saveCode('')">Убрать</button>
        </span>
      </label>
    </div>
    <div class="tw:flex tw:items-center tw:gap-12 tw:flex-wrap tw:mt-12 tw:text-[13px]">
      <span :class="t.status === 'online' ? 'tw:text-up-fg' : t.status === 'error' ? 'tw:text-down-fg' : 'tw:text-muted'">{{ statusLine }}</span>
      <span v-if="t.message" class="tw:text-muted tw:text-[12px]">{{ t.message }}</span>
      <button v-if="form.enabled && form.url" @click="reconnect">Переподключить</button>
      <span v-if="error" class="tw:text-down-fg">{{ error }}</span>
    </div>
    <p class="muted small tw:mt-10 tw:mb-0 tw:text-[12px]">
      Это устройство: <span class="tw:font-data tw:text-text-2">{{ fingerprint(t.deviceId) }}</span> — по этому отпечатку вас различают, даже если имена совпадают.
    </p>
  </section>
</template>
