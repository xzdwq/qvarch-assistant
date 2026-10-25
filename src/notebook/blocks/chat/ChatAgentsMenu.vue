<script setup lang="ts">
/**
 * A chat's AI agents: one's own put in / taken out (each called then by its name, `@ИИ · Имя`), the others' listed;
 * whether the others may call one's own (off by default) — in the chat's settings (ChatSettingsMenu).
 */
import { computed, ref } from 'vue'
import type { ChatRoom } from '@shared/transport/chat'
import { remoteError } from '@shared/remoteError'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { addAgentToChat, agentIdOfProfile, agentProfiles, loadAgents, removeAgentFromChat } from '@renderer/lib/agents'
import { chatMe } from '@renderer/lib/chat'
import { rememberSettingsCategory } from '@renderer/app/settings/settingsCategories'
import { view } from '@renderer/lib/views'

const props = defineProps<{ room: ChatRoom; live: boolean }>()
const btn = ref<HTMLElement>()
const open = ref(false)
const error = ref('')
const busy = ref(false)
const inRoom = computed(() => new Set((props.room.agents ?? []).map((a) => a.id)))
const others = computed(() => (props.room.agents ?? []).filter((a) => a.owner !== chatMe.value))
const count = computed(() => props.room.agents?.length ?? 0)

async function toggle(): Promise<void> {
  open.value = !open.value
  error.value = ''
  if (open.value) await loadAgents(true).catch((e) => (error.value = remoteError(e)))
}
/** The server says so of a method it does not know: it is older than this app. */
const OLDER_SERVER = /^Нет метода /
/** A change done (a failed one — said; a switch clicked shows the state as it is, not as clicked). */
async function act(fn: () => Promise<unknown>, box?: EventTarget | null): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    const msg = remoteError(e)
    error.value = OLDER_SERVER.test(msg) ? 'Сервер чата старой версии — обновите его, чтобы ИИ работал в серверных чатах. В чате без сервера ИИ работает уже сейчас.' : msg
  } finally {
    busy.value = false
    if (box instanceof HTMLInputElement) box.checked = inRoom.value.has(box.dataset.agent ?? '')
  }
}
function toSettings(): void {
  open.value = false
  rememberSettingsCategory('ai')
  view.value = 'settings'
}
</script>

<template>
  <span ref="btn" class="tw:inline-flex tw:flex-none">
    <button class="tw:inline-flex tw:items-center tw:gap-4 tw:h-26 tw:py-0 tw:px-10 tw:rounded-full" :class="{ on: open }" :disabled="!live" :title="live ? 'ИИ в этом чате' : 'Нужен сервер'" @click="toggle">
      <Icon name="sparkles" :size="13" />ИИ<span v-if="count" class="tw:text-muted tw:font-data">{{ count }}</span>
    </button>
  </span>
  <Popover v-model:open="open" :anchor="btn" :width="300" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-6 tw:p-10 tw:border tw:border-border-2 tw:rounded-[14px] tw:bg-pop tw:shadow-pop tw:text-[12.5px] tw:whitespace-normal">
    <span class="tw:text-muted">Мои ИИ — позвать в чате: @имя</span>
    <label v-for="p in agentProfiles" :key="p.id" class="tw:flex tw:items-center tw:gap-8 tw:h-28 tw:px-4 tw:rounded-r2 tw:cursor-pointer tw:hover:bg-hover">
      <input type="checkbox" :data-agent="agentIdOfProfile(p)" :checked="inRoom.has(agentIdOfProfile(p))" :disabled="busy" @change="(e) => act(() => (inRoom.has(agentIdOfProfile(p)) ? removeAgentFromChat(room.id, agentIdOfProfile(p)) : addAgentToChat(room.id, p)), e.target)" />
      <span class="tw:min-w-0 tw:truncate">{{ p.name }}</span>
    </label>
    <button v-if="!agentProfiles.length" class="tw:h-28 tw:py-0 tw:rounded-full" @click="toSettings">Настроить ИИ…</button>
    <template v-if="others.length">
      <span class="tw:mt-4 tw:text-muted">ИИ других участников</span>
      <span v-for="a in others" :key="a.id" class="tw:flex tw:items-center tw:gap-6 tw:px-4 tw:min-w-0"><Icon name="sparkles" :size="11" /><span class="tw:truncate">{{ a.name }}</span></span>
    </template>
    <span v-if="error" class="tw:text-down-fg">{{ error }}</span>
  </Popover>
</template>
