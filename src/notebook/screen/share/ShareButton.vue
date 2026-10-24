<script setup lang="ts">
/**
 * «Совместная работа» of the active note: open it to others (a shared document), invite by a code with a role, the
 * members and their roles, who is in it now; leave it (the owner — close it for everyone). A code from someone else —
 * joined right here (its note comes into «Общие»).
 */
import { computed, ref } from 'vue'
import { INVITE_ROLES, ROLE_LABEL, ROLE_RIGHTS, showInvite, type SpaceRole } from '@shared/transport/space'
import { remoteError } from '@shared/remoteError'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { serverCall, useTransport } from '@renderer/lib/transport'
import { noteName } from '@nb/domain/notePaths'
import { openFile } from '@nb/workspace/paneLayout'
import { loadTree } from '@nb/workspace/vaultTreeStore'
import { shareNote, sharedDocOfPath, sharedInfo, spaceOfPath } from '@nb/workspace/sharedDocs'
import { joinByCode } from '@nb/workspace/sharedFolders'

const props = defineProps<{ path: string }>()
const btn = ref<HTMLElement>()
const open = ref(false)
const transport = useTransport()
const online = computed(() => transport.value.status === 'online')
const doc = computed(() => sharedDocOfPath(props.path))
const inf = computed(() => sharedInfo.get(doc.value))
const space = computed(() => spaceOfPath(props.path))
const me = computed(() => transport.value.deviceId)
const manage = computed(() => !!space.value && ROLE_RIGHTS[space.value.role].manage)
const here = (id: string) => !!inf.value?.presence.some((d) => d.id === id)
/** Others in the note now (the button shows them). */
const othersHere = computed(() => (inf.value?.presence ?? []).filter((d) => d.id !== me.value).length)

const busy = ref(false)
const error = ref('')
async function act(fn: () => Promise<unknown>): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = remoteError(e)
  } finally {
    busy.value = false
  }
}
const share = () => act(() => shareNote(props.path, noteName(props.path)))

const inviteRole = ref<SpaceRole>('editor')
const code = ref('')
const copied = ref(false)
const invite = () => act(async () => (code.value = (await serverCall('space.invite', { space: space.value!.id, role: inviteRole.value })).code))
async function copyCode(): Promise<void> {
  await navigator.clipboard.writeText(showInvite(code.value))
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
const setRole = (device: string, role: SpaceRole) => act(() => serverCall('space.setRole', { space: space.value!.id, device, role }))
const remove = (device: string, name: string) => confirm(`Убрать «${name}» из документа? У него останется локальная копия.`) && act(() => serverCall('space.remove', { space: space.value!.id, device }))
function leave(): void {
  const owner = space.value?.role === 'owner'
  const ask = owner ? 'Закрыть доступ для всех? У каждого останется обычная локальная копия.' : 'Покинуть документ? У вас останется обычная локальная копия.'
  if (confirm(ask)) void act(() => serverCall('space.leave', { space: space.value!.id }))
}

const joinCode = ref('')
const join = () =>
  act(async () => {
    const path = await joinByCode(joinCode.value)
    joinCode.value = ''
    await loadTree()
    openFile(path)
    open.value = false
  })
</script>

<template>
  <span ref="btn" class="tw:inline-flex">
    <button
      class="tw:relative tw:inline-flex tw:items-center tw:justify-center tw:gap-3 tw:min-w-28 tw:h-28 tw:px-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:[&.on]:text-accent-fg"
      :class="{ on: !!doc }"
      :title="doc ? 'Совместная работа: участники, приглашение' : 'Поделиться заметкой'"
      @click="open = !open"
    >
      <Icon name="users" :size="14" /><span v-if="othersHere" class="tw:text-[11px] tw:font-data">{{ othersHere }}</span>
    </button>
    <Popover v-model:open="open" :anchor="btn" :width="340" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-10 tw:p-12 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]">
      <b class="tw:text-text-hi tw:text-[13px]">Совместная работа</b>
      <p v-if="!online" class="tw:m-0 tw:text-muted">{{ transport.status === 'off' ? 'Сервер не подключён — Настройки → Сервер и чат' : 'Нет связи с сервером' }}</p>

      <template v-if="!doc">
        <p class="tw:m-0 tw:text-muted">Откройте доступ — и пригласите других по коду: правка вместе в реальном времени, чат прямо в заметке (@чат).</p>
        <button class="primary tw:self-start" :disabled="!online || busy" @click="share">Открыть доступ</button>
      </template>

      <template v-else>
        <span v-if="space?.kind === 'folder'" class="tw:text-text">Общая папка «{{ space.title }}» — участники видят все её заметки</span>
        <span class="tw:text-muted">
          {{ inf?.live ? 'В реальном времени' : 'Нет связи — правки отправятся позже' }}<template v-if="inf?.role"> · вы — {{ ROLE_LABEL[inf.role].toLowerCase() }}</template>
        </span>
        <!-- the members: one grid — a dot, the name, the role (a list or a word) in one column, «убрать» -->
        <div v-if="space" class="tw:grid tw:grid-cols-[8px_minmax(0,1fr)_128px_26px] tw:items-center tw:gap-x-8 tw:gap-y-6">
          <template v-for="m in space.members" :key="m.id">
            <span class="tw:w-7 tw:h-7 tw:rounded-[50%]" :class="here(m.id) ? 'tw:bg-up' : 'tw:bg-white/14'" :title="here(m.id) ? 'Сейчас в документе' : 'Не в документе'"></span>
            <span class="tw:truncate tw:text-text">{{ m.name }}<template v-if="m.id === me"> (вы)</template></span>
            <select v-if="manage && m.role !== 'owner'" class="tw:w-full tw:h-30 tw:text-[12px]" :value="m.role" :disabled="busy" @change="setRole(m.id, ($event.target as HTMLSelectElement).value as SpaceRole)">
              <option v-for="r in INVITE_ROLES" :key="r" :value="r">{{ ROLE_LABEL[r] }}</option>
            </select>
            <span v-else class="tw:flex tw:items-center tw:h-30 tw:px-9 tw:text-muted">{{ ROLE_LABEL[m.role] }}</span>
            <button v-if="manage && m.role !== 'owner'" class="tw:inline-flex tw:w-26 tw:h-26 tw:p-0 tw:items-center tw:justify-center tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-down-fg" title="Убрать из документа" :disabled="busy" @click="remove(m.id, m.name)"><Icon name="x" :size="12" /></button>
            <span v-else></span>
          </template>
        </div>
        <div v-if="manage" class="tw:flex tw:flex-col tw:gap-8 tw:pt-10 tw:border-t tw:border-t-border">
          <span class="tw:text-muted">Пригласить по коду (действует 7 дней)</span>
          <div class="tw:grid tw:grid-cols-[128px_minmax(0,1fr)] tw:gap-8">
            <select v-model="inviteRole" class="tw:w-full tw:h-30 tw:text-[12px]">
              <option v-for="r in INVITE_ROLES" :key="r" :value="r">{{ ROLE_LABEL[r] }}</option>
            </select>
            <button class="tw:h-30" :disabled="!online || busy" @click="invite">Создать код</button>
            <template v-if="code">
              <b class="tw:flex tw:items-center tw:h-30 tw:font-data tw:text-[15px] tw:tracking-[0.08em] tw:text-text-hi tw:select-all">{{ showInvite(code) }}</b>
              <button class="tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-30" @click="copyCode"><Icon :name="copied ? 'check' : 'copy'" :size="12" />{{ copied ? 'Скопирован' : 'Копировать' }}</button>
            </template>
          </div>
        </div>
        <div class="tw:flex tw:pt-10 tw:border-t tw:border-t-border">
          <button class="tw:h-30" :disabled="!online || busy || !space" @click="leave">{{ space?.role === 'owner' ? (space.kind === 'folder' ? 'Закрыть доступ к папке' : 'Закрыть доступ') : space?.kind === 'folder' ? 'Покинуть папку' : 'Покинуть документ' }}</button>
        </div>
      </template>

      <div class="tw:flex tw:flex-col tw:gap-8 tw:pt-10 tw:border-t tw:border-t-border">
        <span class="tw:text-muted">Есть код приглашения? Заметка или папка появится в «Общие».</span>
        <div class="tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:gap-8">
          <input v-model="joinCode" class="tw:h-30 tw:min-w-0 tw:font-data tw:uppercase" placeholder="XXXX-XXXX" spellcheck="false" @keydown.enter="joinCode.trim() && join()" />
          <button class="tw:h-30" :disabled="!online || busy || !joinCode.trim()" @click="join">Подключиться</button>
        </div>
      </div>
      <span v-if="error" class="tw:text-down-fg">{{ error }}</span>
    </Popover>
  </span>
</template>
