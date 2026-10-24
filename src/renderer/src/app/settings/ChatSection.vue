<script setup lang="ts">
/** Settings · the chat: how a message is sent, notifications; applied at once. */
import { reactive } from 'vue'
import type { ChatSendKey } from '@shared/transport/constants'
import { useSettingsContext } from './settingsContext'
import { SWITCH } from './switchClass'

const { initial, apply } = useSettingsContext()
const chat = reactive({ ...initial.chat })
/** The common settings only (each chat's own way is kept by the chat itself — never overwritten from here). */
async function applyChat(): Promise<void> {
  await apply({ chat: { sendKey: chat.sendKey, notifyAll: chat.notifyAll } })
}
const SEND_KEYS: Record<ChatSendKey, string> = { enter: 'Enter (Shift+Enter — новая строка)', ctrlEnter: 'Ctrl+Enter (Enter — новая строка)' }
</script>

<template>
  <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
    <h3 class="tw:mt-0 tw:mb-8 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Чат</h3>
    <div class="tw:grid tw:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] tw:gap-12">
      <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">
        Отправка сообщения
        <select v-model="chat.sendKey" @change="applyChat">
          <option v-for="(label, k) in SEND_KEYS" :key="k" :value="k">{{ label }}</option>
        </select>
      </label>
    </div>
    <label class="tw:flex tw:items-center tw:justify-between tw:gap-10 tw:max-w-420 tw:mt-8 tw:py-5 tw:text-text tw:text-[13px] tw:cursor-pointer">
      <span>Уведомления о сообщениях всех чатов, когда окно не на переднем плане (у чата — свой переключатель 🔔)</span>
      <input v-model="chat.notifyAll" :class="SWITCH" type="checkbox" @change="applyChat" />
    </label>
  </section>
</template>
