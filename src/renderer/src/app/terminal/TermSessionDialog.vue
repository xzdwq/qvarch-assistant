<script setup lang="ts">
/** An SSH session: name, folder, host, port, user, password (kept encrypted), where the explorer opens. */
import { computed } from 'vue'
import SuggestInput from '../../components/SuggestInput.vue'
import { useSshSessions } from '../../lib/ssh'
import { useTermView } from './termViewContext'

const { editing, error, saveSession } = useTermView().sessions
const sessions = useSshSessions()
/** The folders there are (offered when one is typed). */
const folders = computed(() => [...new Set(sessions.value.map((s) => s.folder).filter(Boolean))].sort())
</script>

<template>
  <div v-if="editing" class="tq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[10vh] tw:bg-black/55" @mousedown.self="editing = undefined">
    <form class="tq tw:flex tw:flex-col tw:gap-10 tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:w-[min(520px,calc(100vw-32px))]" @submit.prevent="saveSession" @keydown.esc="editing = undefined">
      <div class="cap">{{ editing.id ? 'Сессия SSH' : 'Новая сессия SSH' }}</div>
      <div class="tw:grid tw:grid-cols-[minmax(0,1fr)_90px] tw:gap-8">
        <label class="tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Хост<input v-model="editing.host" class="tw:font-data" spellcheck="false" placeholder="server.example или 10.0.0.5" /></label>
        <label class="tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Порт<input v-model.number="editing.port" class="tw:font-data" type="number" min="1" max="65535" /></label>
      </div>
      <label class="tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Пользователь<input v-model="editing.user" class="tw:font-data" spellcheck="false" autocomplete="off" /></label>
      <label class="tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">
        Пароль
        <input v-model="editing.password" type="password" autocomplete="new-password" :placeholder="editing.hasPassword && !editing.forget ? 'сохранён — введите, чтобы заменить' : 'не сохранён — спросим при подключении'" :disabled="editing.forget" />
      </label>
      <label v-if="editing.hasPassword" class="tw:flex tw:items-center tw:gap-8 tw:text-text-2 tw:text-[12.5px]"><input v-model="editing.forget" type="checkbox" />Забыть сохранённый пароль</label>
      <div class="tw:grid tw:grid-cols-2 tw:gap-8">
        <label class="tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Название<input v-model="editing.name" spellcheck="false" :placeholder="editing.user && editing.host ? `${editing.user}@${editing.host}` : 'user@host'" /></label>
        <label class="tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Папка<SuggestInput v-model="editing.folder" :options="folders" placeholder="Работа/Серверы" /></label>
      </div>
      <label class="tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Папка проводника при открытии<input v-model="editing.startDir" class="tw:font-data" spellcheck="false" placeholder="домашняя папка пользователя" /></label>
      <label class="tw:flex tw:items-center tw:gap-8 tw:text-text-2 tw:text-[12.5px]" title="После входа в оболочку незаметно вписывается крючок приглашения (bash / zsh): строка пути над терминалом и проводник следуют за папкой терминала"><input v-model="editing.followCwd" type="checkbox" />Следить за папкой терминала (bash / zsh)</label>
      <p v-if="error" class="tw:m-0 tw:text-down-fg tw:text-[12px]">{{ error }}</p>
      <div class="tw:flex tw:gap-8"><button type="submit" class="primary" :disabled="!editing.host.trim() || !editing.user.trim()">Сохранить</button><button type="button" @click="editing = undefined">Отмена</button></div>
    </form>
  </div>
</template>
