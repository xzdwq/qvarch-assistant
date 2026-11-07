<script setup lang="ts">
/** A folder of the SSH sessions' tree: its sub-folders (folded or not) and its sessions; double click — a terminal. */
import type { SessionFolder } from '@shared/ssh/sessions'
import type { SshSession } from '@shared/ssh/sessions'
import Icon from '../../components/Icon.vue'
import { useTermView } from './termViewContext'

defineOptions({ name: 'TermSessionFolder' })
const props = defineProps<{ folder: SessionFolder; depth: number; folded: Set<string>; busy?: string }>()
const emit = defineEmits<{ toggle: [path: string]; open: [s: SshSession]; menu: [s: SshSession, e: MouseEvent] }>()
const { sessions } = useTermView()
const pad = (d: number) => ({ paddingLeft: `${8 + d * 14}px` })
</script>

<template>
  <template v-for="f in props.folder.folders" :key="f.path">
    <div class="tw:group/sf tw:flex tw:items-center tw:gap-6 tw:h-28 tw:pr-4 tw:text-text-2 tw:text-[12.5px] tw:cursor-pointer tw:select-none tw:hover:bg-hover" :style="pad(depth)" @click="emit('toggle', f.path)">
      <Icon :name="folded.has(f.path) ? 'chevronRight' : 'chevronDown'" :size="11" class="tw:flex-none tw:text-dim" />
      <Icon :name="folded.has(f.path) ? 'folder' : 'folderOpen'" :size="13" class="tw:flex-none tw:text-warn" />
      <span class="tw:flex-1 tw:min-w-0 tw:truncate">{{ f.name }}</span>
      <button class="tw:hidden tw:group-hover/sf:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-accent-fg" title="Новая сессия в этой папке" @click.stop="sessions.addSession(f.path)"><Icon name="plus" :size="12" /></button>
    </div>
    <TermSessionFolder v-if="!folded.has(f.path)" :folder="f" :depth="depth + 1" :folded="folded" :busy="busy" @toggle="(p) => emit('toggle', p)" @open="(s) => emit('open', s)" @menu="(s, e) => emit('menu', s, e)" />
  </template>
  <div
    v-for="s in props.folder.sessions"
    :key="s.id"
    class="tw:group/ss tw:flex tw:items-center tw:gap-7 tw:h-28 tw:pr-4 tw:text-text tw:text-[12.5px] tw:cursor-pointer tw:select-none tw:hover:bg-hover"
    :style="pad(depth)"
    :title="`${s.user}@${s.host}${s.port === 22 ? '' : `:${s.port}`} · двойной клик — открыть`"
    @dblclick="emit('open', s)"
    @contextmenu.prevent="emit('menu', s, $event)"
  >
    <i v-if="busy === s.id" class="tw:flex-none tw:w-11 tw:h-11 tw:border-2 tw:border-accent tw:[&&]:border-r-transparent tw:rounded-[50%] tw:animate-[Shared-spin_0.8s_linear_infinite]"></i>
    <Icon v-else name="monitor" :size="13" class="tw:flex-none tw:text-info-fg" />
    <span class="tw:flex-1 tw:min-w-0 tw:truncate">{{ s.name }}</span>
    <Icon v-if="s.hasPassword" name="lock" :size="10" class="tw:flex-none tw:text-dim" />
    <button class="tw:hidden tw:group-hover/ss:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-up-fg" title="Открыть терминал" @click.stop="emit('open', s)"><Icon name="play" :size="11" /></button>
    <button class="tw:hidden tw:group-hover/ss:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi" title="Ещё" @click.stop="emit('menu', s, $event)"><Icon name="more" :size="12" /></button>
  </div>
</template>
