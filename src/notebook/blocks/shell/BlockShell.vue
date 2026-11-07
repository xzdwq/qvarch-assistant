<script setup lang="ts">
/**
 * A script run in a shell — PowerShell, cmd or bash — on this PC or on a saved SSH session's server: its output live
 * while it runs, then its value (exit code, streams, lines; with a line filter — the matching lines and their groups).
 * What the person writes here is approved at once; a script changed elsewhere (the AI, a shared folder) is asked about.
 */
import { computed, ref, watch } from 'vue'
import { isShellAsk, type ShellAsk } from '@shared/shell/trust'
import { shellKindOf, type ShellKind } from '@shared/shell/shells'
import type { ShellValue } from '@shared/shell/output'
import { BLOCK_H, infoMd, matchOf, type BlockInfo } from '@nb/domain/blockInfo'
import CodeArea from '@renderer/components/CodeArea.vue'
import Icon from '@renderer/components/Icon.vue'
import MenuButton, { type MenuItem } from '@renderer/components/MenuButton.vue'
import { useFold } from '@renderer/lib/foldState'
import { useSshSessions } from '@renderer/lib/ssh'
import RunHead from '../../ui/RunHead.vue'
import ValueView from '../../ui/ValueView.vue'
import { batchToggle } from '../../ui/batchToggle'
import { useBlockRun } from '../../ui/useBlockRun'
import { useFenceSource } from '../../ui/useFenceSource'
import { liveText } from '@nb/engine/shellLive'

const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const fence = useFenceSource(props)
const { info } = fence
const { key, run, start, stop, report } = useBlockRun(props, 'shell', fence)
const batch = batchToggle(fence)
const sessions = useSshSessions()

/**
 * The person's own change approved: the script exactly as they left it (taken at their key / click), a while after
 * the last one — and only if it is still what the block holds then (a change from outside meanwhile: not approved).
 * A change from outside (the AI, a sync) never comes here: the editor tells the person's edits apart.
 */
let approveTimer: ReturnType<typeof setTimeout> | undefined
function approveMine(snap: { info: BlockInfo; body: string }): void {
  clearTimeout(approveTimer)
  const line = infoMd(snap.info)
  approveTimer = setTimeout(async () => {
    const now = fence.current()
    if (now.body !== snap.body || infoMd(now.info) !== line) return
    const t = await window.qa.shellTrust({ notePath: props.path, infoLine: line, body: snap.body })
    if (!t.approved) await window.qa.shellApprove(t.fingerprint)
  }, 800)
}
const code = computed({ get: () => fence.body.value, set: (v: string) => void (fence.body.value = v) })
/** Typed by the person (not a change that came from outside). */
const onUserEdit = (text: string) => approveMine({ info: fence.current().info, body: text })
/** A setting changed by the person's click: written, the block as it is now approved. */
const patch = (p: Partial<BlockInfo>) => {
  fence.patchInfo(p)
  approveMine(fence.current())
}
const rename = (name: string | undefined) => patch({ name })

/** Each shell's name and the language its block is written as. */
const SHELLS: Record<ShellKind, { label: string; lang: string; hl: string }> = {
  powershell: { label: 'PowerShell', lang: 'powershell', hl: 'powershell' },
  cmd: { label: 'cmd', lang: 'cmd', hl: 'text' },
  bash: { label: 'bash', lang: 'bash', hl: 'bash' },
}
const kind = computed<ShellKind>(() => shellKindOf(info.value.lang) ?? 'powershell')
const shellItems = computed<MenuItem[]>(() => (Object.keys(SHELLS) as ShellKind[]).map((k) => ({ label: SHELLS[k].label, icon: k === kind.value ? 'check' : undefined, run: () => patch({ lang: SHELLS[k].lang }) })))

/** Where it runs: this PC, or a saved SSH session (by its id; a session since deleted — said so). */
const session = computed(() => sessions.value.find((s) => s.id === info.value.ssh))
const placeLabel = computed(() => (!info.value.ssh ? 'Этот ПК' : (session.value?.name ?? 'сессия удалена')))
const placeItems = computed<MenuItem[]>(() => [
  { label: 'Этот ПК', icon: info.value.ssh ? undefined : 'check', run: () => patch({ ssh: undefined }) },
  ...sessions.value.map((s) => ({ label: s.name, icon: s.id === info.value.ssh ? 'check' : 'monitor', run: () => patch({ ssh: s.id, cwd: undefined }) })),
])

/** When its script is asked about: the menu's words, and what each means in full (the item's tooltip). */
const ASK: Record<ShellAsk, { label: string; hint: string }> = {
  auto: { label: 'Если изменён не мной', hint: 'Свои правки разрешены сразу; изменённый ИИ, общей папкой или синхронизацией — спросить один раз' },
  always: { label: 'Спрашивать каждый раз', hint: 'Перед каждым запуском — вопрос со скриптом целиком' },
  never: { label: 'Не спрашивать, пока не изменён', hint: 'Одобренный скрипт — без вопросов; любое изменение — снова вопрос' },
  trust: { label: 'Разрешить всегда', hint: 'Без вопросов, даже если скрипт потом изменили (ИИ, общая папка). Вопрос будет только при смене самой строки блока — например, другой сервер' },
}
const ask = computed<ShellAsk>(() => info.value.ask ?? 'auto')
const askItems = computed<MenuItem[]>(() => (Object.keys(ASK) as ShellAsk[]).filter(isShellAsk).map((a) => ({ label: ASK[a].label, title: ASK[a].hint, icon: a === ask.value ? 'check' : undefined, run: () => patch({ ask: a === 'auto' ? undefined : a }) })))

/** The folder it starts in: typed (a server's path too), or picked in a dialog here; empty — the home folder. */
const cwdDraft = ref(info.value.cwd ?? '')
watch(
  () => info.value.cwd,
  (c) => (cwdDraft.value = c ?? ''),
)
function commitCwd(): void {
  const v = cwdDraft.value.trim()
  if ((v || undefined) !== info.value.cwd) patch({ cwd: v || undefined })
}
async function pickCwd(): Promise<void> {
  const dir = await window.qa.ssh('pickFolder', 'Папка запуска скрипта', info.value.cwd)
  if (dir) patch({ cwd: dir })
}

/** Folded: only its head shows (remembered per block). */
const open = useFold(() => `${props.path}#${key.value}#open`, true)
/** The output's height, px (the bottom edge dragged — kept in the block's line; not part of its approval). */
const outH = ref(info.value.h ?? 260)
watch(
  () => info.value.h,
  (h) => (outH.value = h ?? 260),
)
function dragOut(e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const y0 = e.clientY
  const h0 = outH.value
  const move = (m: PointerEvent) => (outH.value = Math.round(Math.min(BLOCK_H.max, Math.max(BLOCK_H.min, h0 + m.clientY - y0))))
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    if (outH.value !== h0) fence.patchInfo({ h: outH.value })
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}

/** The line filter typed: taken when it is a /pattern/flags (empty — none); a bad one stays red. */
const matchDraft = ref(info.value.match ?? '')
const matchBad = computed(() => !!matchDraft.value.trim() && !matchOf(matchDraft.value.trim()))
/** The filter's field: shown while one is set, or once asked for. */
const filterOpen = ref(false)
const filterShown = computed(() => filterOpen.value || !!info.value.match)
function commitMatch(): void {
  const v = matchDraft.value.trim()
  if (v && !matchOf(v)) return
  if ((v || undefined) !== info.value.match) patch({ match: v || undefined })
}

const go = async () => {
  fence.flush()
  await start()
}
const live = computed(() => liveText(props.path, key.value))
const value = computed(() => (run.value?.hasValue ? (run.value.value as ShellValue) : undefined))
const showValue = useFold(() => `${props.path}#${key.value}#value`, false)
</script>

<template>
  <div class="bsh tw:contain-[inline-size] tw:min-w-0 tw:flex tw:flex-col tw:gap-6 tw:pt-8 tw:pr-10 tw:pb-10 tw:pl-10 tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-(--block-code) tw:rounded-[8px] tw:bg-panel">
    <RunHead :batch="batch" :fold="{ open, set: (o: boolean) => (open = o) }" :report="report" icon="terminal" kind="Оболочка" :name="info.name" :run="run" name-placeholder="вывод" @rename="rename" @run="go" @stop="stop">
      <MenuButton :label="SHELLS[kind].label" :items="shellItems" title="Оболочка" :width="160" />
      <MenuButton :label="placeLabel" :icon="info.ssh ? 'monitor' : undefined" :items="placeItems" title="Где выполнить: на этом ПК или на сервере по сохранённой сессии SSH" :width="260" />
      <MenuButton icon="lock" :items="askItems" :title="`Разрешение на запуск: ${ASK[ask].label} — ${ASK[ask].hint}`" :width="260" />
    </RunHead>
    <template v-if="open">
      <CodeArea v-model="code" :lang="SHELLS[kind].hl" @user-edit="onUserEdit" :run="go" :min-height="40" :placeholder="kind === 'powershell' ? 'Get-PSDrive C | Select-Object Used, Free' : kind === 'cmd' ? 'dir /b' : 'df -h /'" />
      <div class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:text-muted tw:text-[11.5px]">
        <!-- the folder it starts in: typed (a server's path too), picked here; empty — the home folder -->
        <button v-if="!info.ssh" class="tw:inline-flex tw:flex-none tw:p-3 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-warn tw:hover:bg-hover" title="Выбрать папку запуска" @mousedown.prevent @click="pickCwd"><Icon name="folderOpen" :size="13" /></button>
        <Icon v-else name="folderOpen" :size="13" class="tw:flex-none tw:text-warn" />
        <input v-model="cwdDraft" class="tw:flex-[0_1_40%] tw:min-w-60 tw:h-22 tw:font-data tw:text-[11.5px]" spellcheck="false" :placeholder="info.ssh ? '~ — домашняя папка на сервере' : 'домашняя папка'" :title="`Папка, в которой выполняется скрипт${info.ssh ? ' (на сервере)' : ''}; пусто — домашняя`" @blur="commitCwd" @keydown.enter.prevent="commitCwd" />
        <span class="tw:flex-1"></span>
        <!-- the line filter: shown when one is set or asked for (rarely needed — it takes numbers out for conditions) -->
        <button class="tw:inline-flex tw:flex-none tw:p-3 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:[&.on]:text-accent-fg" :class="{ on: filterShown }" title="Фильтр строк вывода: оставить только совпавшие строки, их группы — в matches (например, /(\d+)%/ из df -h — число для условия)" @mousedown.prevent @click="filterOpen = !filterOpen"><Icon name="regex" :size="12" /></button>
        <input v-if="filterShown" v-model="matchDraft" class="tw:flex-[0_1_45%] tw:min-w-60 tw:h-22 tw:font-data tw:text-[11.5px] tw:[&.bad]:border-down" :class="{ bad: matchBad }" spellcheck="false" placeholder="/(\d+)%/" title="Регулярное выражение /…/флаги: только совпавшие строки попадают в lines, их группы — в matches" @blur="commitMatch" @keydown.enter.prevent="commitMatch" />
      </div>
      <!-- what it prints while it runs; then the run's value (the output's bottom edge dragged — its height) -->
      <template v-if="live !== undefined || value?.stdout || value?.stderr">
        <pre v-if="live !== undefined" class="tw:m-0 tw:overflow-auto tw:py-6 tw:px-8 tw:rounded-[6px] tw:bg-bg tw:text-text-2 tw:font-data tw:text-[12px] tw:whitespace-pre-wrap tw:[word-break:break-word]" :style="{ maxHeight: `${outH}px` }">{{ live || '…' }}</pre>
        <pre v-else class="tw:m-0 tw:overflow-auto tw:py-6 tw:px-8 tw:rounded-[6px] tw:bg-bg tw:font-data tw:text-[12px] tw:whitespace-pre-wrap tw:[word-break:break-word]" :style="{ maxHeight: `${outH}px` }"><span class="tw:text-text-2">{{ value?.stdout }}</span><span class="tw:text-down-fg">{{ value?.stderr }}</span></pre>
        <div class="tw:group/grip tw:flex tw:flex-none tw:items-center tw:justify-center tw:h-8 tw:-mt-4 tw:cursor-ns-resize tw:select-none tw:touch-none" title="Потяните — выше или ниже" @pointerdown.prevent="dragOut"><span class="tw:w-36 tw:h-3 tw:rounded-[2px] tw:bg-border-2 tw:group-hover/grip:bg-accent"></span></div>
      </template>
    </template>
    <template v-if="open && live === undefined && run && run.state !== 'run'">
      <p v-if="run.error" class="tw:m-0 tw:text-down-fg tw:font-data tw:text-[12px] tw:whitespace-pre-wrap">{{ run.error }}</p>
      <template v-if="value">
        <div class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:text-[12px] tw:whitespace-nowrap">
          <button class="tw:inline-flex tw:flex-none tw:w-22 tw:h-22 tw:items-center tw:justify-center tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:bg-hover" @mousedown.prevent @click="showValue = !showValue"><Icon :name="showValue ? 'chevronDown' : 'chevronRight'" :size="12" /></button>
          <b class="tw:flex-none">Значение</b>
          <span class="tw:min-w-0 tw:truncate tw:text-muted tw:text-[11.5px]" :title="value.cwd ? `Папка: ${value.cwd}` : undefined">код {{ value.exitCode }} · строк {{ value.lines.length }}<template v-if="value.matches"> · совпадений {{ value.matches.length }}</template><template v-if="value.truncated"> · вывод обрезан до последних 2 МБ</template><template v-if="value.cwd"> · в {{ value.cwd }}</template></span>
          <span v-if="info.name" class="tw:text-muted tw:text-[11.5px] tw:truncate">→ {{ '{' }}{{ '{' }}{{ info.name }}.lines{{ '}' }}{{ '}' }}</span>
        </div>
        <ValueView v-if="showValue" :value="value" :name="info.name" />
      </template>
    </template>
  </div>
</template>
