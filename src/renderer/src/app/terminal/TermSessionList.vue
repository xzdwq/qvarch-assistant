<script setup lang="ts">
/** The saved SSH sessions as a tree of folders (as MobaXterm keeps them): open one in a tab, edit, copy, remove. */
import { computed, ref, watch } from 'vue'
import { sessionTree, type SshSession } from '@shared/ssh/sessions'
import Icon from '../../components/Icon.vue'
import Popover from '../../components/Popover.vue'
import { openWhile } from '../../lib/usePopover'
import { useSshSessions } from '../../lib/ssh'
import TermSessionFolder from './TermSessionFolder.vue'
import { useTermView } from './termViewContext'

const { sessions, shells } = useTermView()
const list = useSshSessions()
const tree = computed(() => sessionTree(list.value))

/** The folded folders, remembered. */
const FOLDED_KEY = 'qa.term.sshFolded'
const folded = ref(new Set<string>(readFolded()))
function readFolded(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
watch(folded, (f) => {
  try {
    localStorage.setItem(FOLDED_KEY, JSON.stringify([...f]))
  } catch {
    // fine
  }
})
function toggle(path: string): void {
  const next = new Set(folded.value)
  if (!next.delete(path)) next.add(path)
  folded.value = next
}

/** The session being connected (its spinner), the last failure. */
const busy = ref<string>()
const error = ref('')
async function open(s: SshSession): Promise<void> {
  if (busy.value) return
  busy.value = s.id
  error.value = ''
  try {
    await shells.newSshShell(s.id)
  } catch (e) {
    error.value = `${s.name}: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = undefined
  }
}

/** A session's menu (its «…» or a right click). */
const menu = ref<{ s: SshSession; at: { x: number; y: number } }>()
const menuOpen = openWhile(menu)
const onMenu = (s: SshSession, e: MouseEvent) => (menu.value = { s, at: { x: e.clientX, y: e.clientY } })
/** The menu's items: what each does with its session. */
const MENU: Array<{ label: string; icon: string; run: (s: SshSession) => void }> = [
  { label: 'Открыть терминал', icon: 'play', run: (s) => void open(s) },
  { label: 'Изменить', icon: 'pencil', run: (s) => sessions.editSession(s) },
  { label: 'Копировать', icon: 'copy', run: (s) => sessions.copySession(s) },
  { label: 'Удалить', icon: 'trash', run: (s) => void sessions.deleteSession(s) },
]
</script>

<template>
  <div class="tw:flex tw:items-center tw:h-32 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-12">
    <span class="cap">Сессии SSH</span>
    <span class="tw:flex-1"></span>
    <button class="tw:inline-flex tw:p-5 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-accent-fg" title="Новая сессия" @click="sessions.addSession()"><Icon name="plus" :size="14" /></button>
  </div>
  <div class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:pb-4">
    <TermSessionFolder :folder="tree" :depth="0" :folded="folded" :busy="busy" @toggle="toggle" @open="open" @menu="onMenu" />
    <p v-if="!list.length" class="tw:my-10 tw:mx-12 tw:text-muted tw:text-[11.5px]">Сессий нет — «+» сверху. Папка сессии пишется через «/»: Работа/Серверы.</p>
  </div>
  <p v-if="error" class="tw:my-6 tw:mx-10 tw:text-down-fg tw:text-[12px] tw:wrap-anywhere">{{ error }}</p>

  <Popover v-model:open="menuOpen" :anchor="menu?.at" :width="200" class="tw:fixed tw:z-3000 tw:flex tw:flex-col tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop">
    <template #default="{ close }">
      <button v-for="m in MENU" :key="m.label" class="tw:flex tw:items-center tw:gap-8 tw:h-28 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-hover" @click="menu && m.run(menu.s), close()">
        <Icon :name="m.icon as 'play'" :size="12" class="tw:text-muted" />{{ m.label }}
      </button>
    </template>
  </Popover>
</template>
