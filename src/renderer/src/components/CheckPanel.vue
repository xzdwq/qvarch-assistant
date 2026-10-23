<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CHECK_KINDS, CHECK_SEVS, CHECK_STEPS, kindMeta, reqLine, type CheckKind, type CheckProblem, type CheckSev } from '@shared/check'
import { bugFileName, bugNote, stepsFromPw } from '@shared/checkBug'
import { checkSteps, pwRec, stopPwRec, watchPwRec } from '../lib/pwrec'
import type { VaultNode } from '@shared/vault'
import { bLayout, checkProblems, checkState, placeTab, tabs } from '../lib/browser'
import { openNote } from '../lib/mentions'
import Icon from './Icon.vue'

/**
 * «Проверка»: the browser watches while the tester works by hand — what looks wrong comes here (the network, the
 * console, the page). A finding opens to its request and answer, shows its element on the page; those picked
 * become a bug note in the notebook (the steps, expected / actual, the requests runnable, the page's picture).
 */
const props = defineProps<{ tabId?: string }>()

const st = computed(() => checkState.value.settings)
const set = (p: Partial<typeof st.value>) => void window.qa.browser('checkSet', p)
const blockedHere = computed(() => !!props.tabId && checkState.value.blocked.includes(props.tabId))

// ---------- the list: by importance, this tab or all, a search ----------
const SEV_LABEL: Record<CheckSev, string> = { high: 'Важные', mid: 'Средние', low: 'Мелкие' }
const SEV = CHECK_SEVS.map((id) => ({ id, label: SEV_LABEL[id] }))
const sev = ref<CheckSev | ''>('')
const onlyTab = ref(false)
const q = ref('')
const base = computed(() => checkProblems.value.filter((p) => (!onlyTab.value || p.tabId === props.tabId) && (!q.value.trim() || `${p.title} ${p.detail ?? ''} ${p.page}`.toLowerCase().includes(q.value.trim().toLowerCase()))))
const shown = computed(() => base.value.filter((p) => !sev.value || p.sev === sev.value))
const countOf = (s: CheckSev) => base.value.filter((p) => p.sev === s).length

const open = ref<string>()
const bodyTab = ref<'req' | 'res'>('res')
// a finding opened: its answer if there is one, else what was sent
watch(open, (id) => {
  const p = checkProblems.value.find((x) => x.id === id)
  bodyTab.value = p?.req?.resBody ? 'res' : 'req'
})
const picked = ref(new Set<string>())
function pick(id: string): void {
  const n = new Set(picked.value)
  if (n.has(id)) n.delete(id)
  else n.add(id)
  picked.value = n
}
// a finding forgotten — not picked any more
watch(checkProblems, (l) => {
  const ids = new Set(l.map((p) => p.id))
  if ([...picked.value].some((id) => !ids.has(id))) picked.value = new Set([...picked.value].filter((id) => ids.has(id)))
})

const time = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const where = (u: string) => {
  try {
    const x = new URL(u)
    return `${x.host}${x.pathname}`
  } catch {
    return u
  }
}
const ICON: Record<CheckKind, string> = { http5xx: 'zap', http4xx: 'lock', netfail: 'x', emptyId: 'braces', double: 'copy', slow: 'timer', nulls: 'braces', console: 'terminal', toast: 'bell', unsaved: 'note', loading: 'refresh', overflow: 'columns', hscroll: 'move' }
function pretty(s?: string): string {
  if (!s) return ''
  if (/^\s*[[{]/.test(s)) {
    try {
      return JSON.stringify(JSON.parse(s), null, 2)
    } catch {
      // as is
    }
  }
  return s
}
async function show(p: CheckProblem): Promise<void> {
  placeTab(bLayout.cur, p.tabId)
  if (p.selector) await window.qa.browser('checkShow', p.tabId, p.selector)
}
const mute = (p: CheckProblem) => void window.qa.browser('checkMute', p.key, true)
const forget = (p: CheckProblem) => void window.qa.browser('checkClear', [p.id])
const clearAll = () => void window.qa.browser('checkClear', shown.value.map((p) => p.id))

// ---------- the settings ----------
const gear = ref(false)
const toggleKind = (k: CheckKind) => set({ off: st.value.off.includes(k) ? st.value.off.filter((x) => x !== k) : [...st.value.off, k] })

// ---------- a bug's steps: recorded in the tab as they are done ----------
watchPwRec()
const stepsOn = computed(() => pwRec.value?.key === CHECK_STEPS)
const curUrl = computed(() => tabs.value.find((t) => t.id === props.tabId)?.url ?? '')
const canRecord = computed(() => /^https?:/i.test(curUrl.value) && !pwRec.value)
async function recordSteps(): Promise<void> {
  if (!canRecord.value) return
  checkSteps.value = undefined
  await window.qa.browser('pwRecStart', '', CHECK_STEPS, curUrl.value)
}

// ---------- a bug note from the picked ----------
const bug = ref<{ title: string; steps: string; expected: string; actual: string; folder: string; shot: boolean; openAfter: boolean }>()
const busy = ref(false)
const made = ref<{ path: string; name: string }>()
const pickedList = computed(() => checkProblems.value.filter((p) => picked.value.has(p.id)))
function startBug(): void {
  const list = pickedList.value
  const first = list[0]
  const page = first?.page ?? curUrl.value
  const rec = checkSteps.value?.lines
  bug.value = {
    title: first ? first.title.replace(/^(Консоль|Сообщение об ошибке): /, '') : '',
    steps: rec?.length ? stepsFromPw(rec) : `1. Открыть ${page}\n2. `,
    expected: '',
    actual: list.map((p) => `- ${p.title}`).join('\n'),
    folder: 'Журнал',
    shot: true,
    openAfter: true,
  }
}
async function ensureFolder(name: string): Promise<string> {
  const n = name.trim().replace(/[\\/]+/g, '/').replace(/^\/|\/$/g, '')
  if (!n) return ''
  const walk = (ns: VaultNode[]): VaultNode[] => ns.flatMap((x) => (x.dir ? [x, ...walk(x.children ?? [])] : []))
  const dirs = walk(await window.qa.vaultTree())
  let path = ''
  for (const part of n.split('/')) {
    const want = path ? `${path}/${part}` : part
    path = dirs.some((d) => d.path === want) ? want : await window.qa.vaultCreate(path, 'folder', part)
  }
  return path
}
async function makeBug(): Promise<void> {
  const b = bug.value
  if (!b || busy.value || !b.title.trim()) return
  busy.value = true
  try {
    const list = pickedList.value
    const tabId = list[0]?.tabId ?? props.tabId
    let shot: string | undefined
    if (b.shot && tabId) {
      const bytes = await window.qa.browser('checkShot', tabId)
      if (bytes) shot = await window.qa.vaultSaveImage(bytes)
    }
    const page = list[0]?.page ?? curUrl.value
    const text = bugNote({ title: b.title.trim(), page, steps: b.steps, expected: b.expected, actual: b.actual, problems: list, scenario: checkSteps.value?.lines, shot, when: Date.now() })
    const dir = await ensureFolder(b.folder)
    const path = await window.qa.vaultCreate(dir, 'note', bugFileName(b.title), text)
    if (list.length) await window.qa.browser('checkNote', list.map((p) => p.id), path)
    checkSteps.value = undefined
    picked.value = new Set()
    bug.value = undefined
    made.value = { path, name: path.split('/').pop()!.replace(/\.md$/, '') }
    if (b.openAfter) void openNote(path)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="ck tw:flex tw:flex-col tw:min-h-0 tw:gap-8 tw:p-10 tw:text-[12.5px]">
    <!-- on / off -->
    <div class="ck-top tw:group/ck-top tw:flex tw:items-center tw:gap-10 tw:py-8 tw:px-10 tw:border tw:border-border tw:rounded-r3 tw:bg-panel-2 tw:[&.on]:border-accent/50" :class="{ on: st.on }">
      <button class="ck-sw tw:relative tw:flex-none tw:w-36 tw:h-20 tw:p-0 tw:border-0 tw:rounded-[10px] tw:bg-panel-3 tw:group-[.on]/ck-top:bg-accent tw:hover:enabled:not-group-[.on]/ck-top:bg-hover tw:hover:enabled:border-border-3" role="switch" :aria-checked="st.on" :title="st.on ? 'Выключить слежение' : 'Включить слежение'" @click="set({ on: !st.on })"><i class="tw:absolute tw:top-3 tw:left-3 tw:w-14 tw:h-14 tw:rounded-[50%] tw:bg-muted tw:[transition:left_0.15s] tw:group-[.on]/ck-top:left-19 tw:group-[.on]/ck-top:bg-white"></i></button>
      <div class="ck-st tw:flex tw:flex-1 tw:flex-col tw:min-w-0">
        <b class="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ st.on ? 'Слежу за вкладками' : 'Слежение выключено' }}</b>
        <small class="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:text-[11px]">{{ st.on ? 'Работайте как обычно — найденное появится ниже' : 'Включите — и ошибки сети, страницы и консоли будут ловиться сами' }}</small>
      </div>
      <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:[&.on]:text-text tw:hover:enabled:text-text tw:[&.on]:bg-hover tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :class="{ on: gear }" title="Что проверять" @click="gear = !gear"><Icon name="settings" :size="14" /></button>
      <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:text-text tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :disabled="!shown.length" title="Очистить показанные" @click="clearAll"><Icon name="trash" :size="14" /></button>
    </div>
    <div class="ck-steps tw:flex tw:items-center tw:gap-6">
      <template v-if="stepsOn">
        <span class="ck-rec tw:inline-flex tw:items-center tw:gap-6 tw:text-down-fg tw:font-semibold"><i class="tw:w-8 tw:h-8 tw:rounded-[50%] tw:bg-down tw:animate-[CheckPanel-ckblink_1s_infinite]"></i>Записываю шаги: {{ pwRec?.count ?? 0 }}</span>
        <span class="grow tw:flex-1"></span>
        <button class="tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-10 tw:text-[12px]" @click="stopPwRec(true)">Отменить</button>
        <button class="primary tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-10 tw:text-[12px]" @click="stopPwRec()">Стоп</button>
      </template>
      <template v-else-if="checkSteps">
        <span class="ck-ok tw:inline-flex tw:items-center tw:gap-6 tw:text-up-fg"><Icon name="check" :size="12" />Шаги записаны: {{ checkSteps.lines.length }} — войдут в запись журнала</span>
        <span class="grow tw:flex-1"></span>
        <button class="lnk tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-10 tw:text-[12px] tw:border-0 tw:bg-transparent tw:text-accent-fg tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="checkSteps = undefined">убрать</button>
        <button v-if="!bug && !picked.size" class="primary tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-10 tw:text-[12px]" @click="startBug"><Icon name="note" :size="12" />В журнал</button>
      </template>
      <template v-else>
        <button class="tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-10 tw:text-[12px]" :disabled="!canRecord" :title="canRecord ? 'Записать, что вы делаете на этой вкладке, — шаги и сценарий войдут в запись журнала' : pwRec ? 'Уже идёт запись' : 'Откройте страницу сайта'" @click="recordSteps"><i class="ck-dot tw:w-8 tw:h-8 tw:rounded-[50%] tw:bg-down"></i>Записать шаги</button>
        <span class="grow tw:flex-1"></span>
        <button class="tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-10 tw:text-[12px]" title="Новая запись в журнал (без найденного) — сценарий, наблюдение, баг" @click="startBug"><Icon name="plus" :size="12" />Новая запись</button>
      </template>
    </div>
    <p v-if="blockedHere && st.on" class="ck-warn tw:flex tw:items-center tw:gap-6 tw:m-0 tw:text-warn-fg tw:text-[11.5px]"><Icon name="lock" :size="12" />На этой вкладке открыты инструменты разработчика — слежение начнётся, когда их закроете.</p>

    <!-- what is checked -->
    <div v-if="gear" class="ck-set tw:flex tw:flex-col tw:gap-8 tw:py-8 tw:px-10 tw:border tw:border-border tw:rounded-r3">
      <div v-for="s in SEV" :key="s.id" class="ck-grp tw:flex tw:flex-col tw:gap-3">
        <span class="ck-gl tw:text-[10.5px] tw:font-semibold tw:tracking-[0.06em] tw:uppercase tw:[&.high]:not-[&.mid]:not-[&.low]:text-down-fg tw:[&.mid]:not-[&.low]:text-warn-fg tw:[&.low]:text-info-fg" :class="s.id">{{ s.label }}</span>
        <label class="tw:flex tw:items-center tw:gap-6" v-for="k in CHECK_KINDS.filter((x) => x.sev === s.id)" :key="k.id" :title="k.hint"><input type="checkbox" :checked="!st.off.includes(k.id)" @change="toggleKind(k.id)" />{{ k.label }}</label>
      </div>
      <div class="ck-nums tw:flex tw:flex-wrap tw:gap-y-6 tw:gap-x-14">
        <label class="tw:flex tw:items-center tw:gap-6">Медленный запрос, с <input class="tw:w-56" type="number" min="1" max="120" :value="st.slowMs / 1000" @change="set({ slowMs: Math.max(1, Number(($event.target as HTMLInputElement).value)) * 1000 })" /></label>
        <label class="tw:flex tw:items-center tw:gap-6">Долгая загрузка, с <input class="tw:w-56" type="number" min="2" max="300" :value="st.loadingMs / 1000" @change="set({ loadingMs: Math.max(2, Number(($event.target as HTMLInputElement).value)) * 1000 })" /></label>
        <label class="tw:flex tw:items-center tw:gap-6" title="Счётчики, карты, шрифты и прочие чужие сайты"><input type="checkbox" :checked="st.allSites" @change="set({ allSites: !st.allSites })" />Запросы других сайтов тоже</label>
        <button v-if="st.mutes.length" class="lnk tw:p-0 tw:border-0 tw:bg-transparent tw:text-accent-fg tw:text-[11.5px] tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Снова показывать всё скрытое" @click="set({ mutes: [] })">Скрыто: {{ st.mutes.length }} — вернуть</button>
      </div>
    </div>

    <!-- importance, this tab, search -->
    <div class="ck-flt tw:flex tw:items-center tw:gap-4">
      <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:text-[11.5px] tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/14 tw:[&.on]:text-text" :class="{ on: !sev }" @click="sev = ''">Все <b class="tw:font-semibold">{{ base.length }}</b></button>
      <button class="tw:group/g25 tw:inline-flex tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:text-[11.5px] tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/14 tw:[&.on]:text-text" v-for="s in SEV" :key="s.id" :class="[s.id, { on: sev === s.id }]" @click="sev = sev === s.id ? '' : s.id"><i class="tw:group-[.high]/g25:not-group-[.mid]/g25:not-group-[.low]/g25:text-down-fg tw:group-[.mid]/g25:not-group-[.low]/g25:text-warn-fg tw:group-[.low]/g25:text-info-fg tw:w-7 tw:h-7 tw:rounded-[50%] tw:bg-current"></i>{{ s.label }} <b class="tw:font-semibold">{{ countOf(s.id) }}</b></button>
      <span class="grow tw:flex-1"></span>
      <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:text-[11.5px] tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/14 tw:[&.on]:text-text" :class="{ on: onlyTab }" title="Только эта вкладка" @click="onlyTab = !onlyTab"><Icon name="browser" :size="12" /></button>
    </div>
    <label class="ck-q tw:flex tw:items-center tw:gap-6 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-muted"><Icon name="search" :size="12" /><input class="tw:flex-1 tw:h-26 tw:border-0 tw:bg-transparent tw:text-text tw:outline-none" v-model="q" placeholder="Поиск по найденному" spellcheck="false" /></label>

    <p v-if="made" class="ck-made tw:flex tw:items-center tw:gap-6 tw:m-0 tw:text-up-fg"><Icon name="check" :size="12" />Записано в журнал: <a href="#" @click.prevent="openNote(made.path)">{{ made.name }}</a><button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:text-text tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="made = undefined"><Icon name="x" :size="11" /></button></p>

    <!-- the findings -->
    <div class="ck-list tw:flex tw:flex-1 tw:flex-col tw:gap-4 tw:min-h-0 tw:overflow-auto">
      <div v-if="!shown.length" class="ck-empty tw:flex tw:flex-col tw:items-center tw:gap-10 tw:py-24 tw:px-12 tw:text-muted tw:text-center tw:leading-[1.5]">
        <Icon name="bug" :size="26" />
        <template v-if="!st.on">
          <p>Включите слежение и работайте с сайтом как обычно. Сюда попадут ошибки сервера, пустые id в запросах, двойные отправки, сообщения об ошибках, «несохранённые изменения» после сохранения, вечные загрузки, вылезающий текст и ошибки консоли.</p>
          <button class="primary" @click="set({ on: true })">Включить</button>
        </template>
        <p v-else>Пока всё чисто.</p>
      </div>
      <div v-for="p in shown" :key="p.id" class="ck-it tw:group/ck-it tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-border-2 tw:rounded-[4px] tw:bg-panel tw:[&.high]:not-[&.mid]:not-[&.low]:border-l-down tw:[&.mid]:not-[&.low]:border-l-warn tw:[&&]:[&.low]:border-l-info tw:[&.done]:opacity-60" :class="[p.sev, { open: open === p.id, done: !!p.note }]">
        <div class="ck-row tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-8 tw:cursor-pointer tw:hover:bg-hover" @click="open = open === p.id ? undefined : p.id">
          <input type="checkbox" :checked="picked.has(p.id)" :title="'Выбрать для журнала'" @click.stop="pick(p.id)" />
          <span class="ck-ic tw:group-[.high]/ck-it:not-group-[.mid]/ck-it:not-group-[.low]/ck-it:text-down-fg tw:group-[.mid]/ck-it:not-group-[.low]/ck-it:text-warn-fg tw:group-[.low]/ck-it:text-info-fg tw:inline-flex tw:flex-none"><Icon :name="ICON[p.kind]" :size="13" /></span>
          <span class="ck-tx tw:flex tw:flex-1 tw:flex-col tw:min-w-0">
            <span class="ck-t tw:overflow-hidden tw:font-medium tw:text-ellipsis tw:whitespace-nowrap">{{ p.title }}</span>
            <small class="tw:overflow-hidden tw:text-muted tw:text-[11px] tw:text-ellipsis tw:whitespace-nowrap">{{ kindMeta(p.kind).label }} · {{ where(p.page) }} · {{ time(p.last) }}</small>
          </span>
          <b v-if="p.count > 1" class="ck-n tw:flex-none tw:py-0 tw:px-6 tw:rounded-[9px] tw:bg-hover tw:text-text-2 tw:text-[11px]" :title="`Повторялось ${p.count} раз`">×{{ p.count }}</b>
          <a v-if="p.note" href="#" class="ck-bug tw:inline-flex tw:flex-none tw:items-center tw:gap-3 tw:text-accent-fg tw:text-[11px]" title="Открыть запись журнала" @click.stop.prevent="openNote(p.note)"><Icon name="note" :size="11" />в журнале</a>
        </div>
        <div v-if="open === p.id" class="ck-det tw:flex tw:flex-col tw:gap-6 tw:pt-4 tw:pr-10 tw:pb-10 tw:pl-30">
          <pre v-if="p.detail" class="ck-d tw:m-0 tw:py-6 tw:px-8 tw:rounded-[4px] tw:bg-panel-2 tw:font-data tw:text-[11.5px] tw:whitespace-pre-wrap tw:[word-break:break-word]">{{ p.detail }}</pre>
          <template v-if="p.req">
            <div class="ck-req tw:flex tw:gap-10 tw:font-data"><b>{{ reqLine(p.req) }}</b><span class="tw:text-muted tw:text-[11px]" v-if="p.req.ms !== undefined">{{ p.req.ms }} мс</span></div>
            <div class="ck-url tw:text-muted tw:text-[11px] tw:overflow-hidden tw:font-data tw:text-ellipsis tw:whitespace-nowrap" :title="p.req.url">{{ p.req.url }}</div>
            <div v-if="p.req.reqBody || p.req.resBody" class="ck-bt tw:flex tw:gap-2">
              <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:text-[11.5px] tw:[&.on]:bg-accent/18 tw:[&.on]:text-accent-fg" :class="{ on: bodyTab === 'req' }" :disabled="!p.req.reqBody" @click="bodyTab = 'req'">Запрос</button>
              <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:text-[11.5px] tw:[&.on]:bg-accent/18 tw:[&.on]:text-accent-fg" :class="{ on: bodyTab === 'res' }" :disabled="!p.req.resBody" @click="bodyTab = 'res'">Ответ</button>
            </div>
            <pre v-if="bodyTab === 'req' && p.req.reqBody" class="ck-body tw:m-0 tw:py-6 tw:px-8 tw:rounded-[4px] tw:bg-panel-2 tw:font-data tw:text-[11.5px] tw:whitespace-pre-wrap tw:[word-break:break-word] tw:max-h-240 tw:overflow-auto">{{ pretty(p.req.reqBody) }}</pre>
            <pre v-else-if="p.req.resBody" class="ck-body tw:m-0 tw:py-6 tw:px-8 tw:rounded-[4px] tw:bg-panel-2 tw:font-data tw:text-[11.5px] tw:whitespace-pre-wrap tw:[word-break:break-word] tw:max-h-240 tw:overflow-auto">{{ pretty(p.req.resBody) }}</pre>
          </template>
          <div class="ck-acts tw:flex tw:flex-wrap tw:gap-4">
            <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:text-[11.5px]" @click="show(p)"><Icon name="eye" :size="12" />{{ p.selector ? 'Показать на странице' : 'К вкладке' }}</button>
            <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:text-[11.5px]" @click="pick(p.id)"><Icon name="note" :size="12" />{{ picked.has(p.id) ? 'Не в журнал' : 'В журнал' }}</button>
            <span class="grow tw:flex-1"></span>
            <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:text-[11.5px]" title="Больше не показывать такие находки" @click="mute(p)"><Icon name="eyeOff" :size="12" />Не показывать такие</button>
            <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:text-[11.5px]" title="Убрать из списка" @click="forget(p)"><Icon name="x" :size="12" /></button>
          </div>
        </div>
      </div>
    </div>

    <!-- a bug from the picked -->
    <div v-if="picked.size && !bug" class="ck-foot tw:flex tw:items-center tw:gap-8 tw:pt-8 tw:border-t tw:border-t-border">
      <span>Выбрано: <b>{{ picked.size }}</b></span>
      <button class="lnk tw:p-0 tw:border-0 tw:bg-transparent tw:text-accent-fg tw:text-[11.5px] tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="picked = new Set()">снять</button>
      <span class="grow tw:flex-1"></span>
      <button class="primary tw:inline-flex tw:items-center tw:gap-6" @click="startBug"><Icon name="note" :size="13" />В журнал</button>
    </div>
    <div v-if="bug" class="ck-form tw:flex tw:flex-col tw:gap-6 tw:p-10 tw:border tw:border-accent/50 tw:rounded-r3 tw:bg-panel-2">
      <div class="ck-fh tw:flex tw:items-center tw:gap-6"><Icon name="note" :size="14" /><b>Запись в журнал</b><span class="grow tw:flex-1"></span><button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:text-text tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="bug = undefined"><Icon name="x" :size="13" /></button></div>
      <label class="tw:flex tw:flex-col tw:gap-3 tw:text-text-2 tw:text-[11.5px]">Название<input class="tw:[&:not([type='checkbox'])]:py-5 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-field tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:[font-style:inherit] tw:[&:not([type='checkbox'])]:[font-variant:inherit] tw:[&:not([type='checkbox'])]:[font-weight:inherit] tw:[&:not([type='checkbox'])]:font-stretch-[inherit] tw:[&:not([type='checkbox'])]:[line-height:inherit] tw:[&:not([type='checkbox'])]:font-[inherit] tw:[&&]:[&:not([type='checkbox'])]:text-[12.5px] tw:[&:not([type='checkbox'])]:resize-y" v-model="bug.title" spellcheck="false" /></label>
      <label class="tw:flex tw:flex-col tw:gap-3 tw:text-text-2 tw:text-[11.5px]">Шаги<textarea class="tw:py-5 tw:px-8 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:resize-y" v-model="bug.steps" rows="3"></textarea></label>
      <label class="tw:flex tw:flex-col tw:gap-3 tw:text-text-2 tw:text-[11.5px]">Ожидаемый результат <small>необязательно</small><textarea class="tw:py-5 tw:px-8 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:resize-y" v-model="bug.expected" rows="2" placeholder="Что должно было произойти"></textarea></label>
      <label class="tw:flex tw:flex-col tw:gap-3 tw:text-text-2 tw:text-[11.5px]">Фактический результат <small>необязательно</small><textarea class="tw:py-5 tw:px-8 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:resize-y" v-model="bug.actual" rows="3"></textarea></label>
      <div class="ck-fr tw:flex tw:items-end tw:flex-wrap tw:gap-10">
        <label class="ck-fold tw:flex tw:flex-1 tw:flex-col tw:gap-3 tw:min-w-120 tw:text-text-2 tw:text-[11.5px]">Папка<input class="tw:[&:not([type='checkbox'])]:py-5 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-field tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:[font-style:inherit] tw:[&:not([type='checkbox'])]:[font-variant:inherit] tw:[&:not([type='checkbox'])]:[font-weight:inherit] tw:[&:not([type='checkbox'])]:font-stretch-[inherit] tw:[&:not([type='checkbox'])]:[line-height:inherit] tw:[&:not([type='checkbox'])]:font-[inherit] tw:[&&]:[&:not([type='checkbox'])]:text-[12.5px] tw:[&:not([type='checkbox'])]:resize-y" v-model="bug.folder" spellcheck="false" /></label>
        <label class="chk tw:inline-flex tw:items-center tw:gap-5"><input class="tw:[&:not([type='checkbox'])]:py-5 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-field tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:[font-style:inherit] tw:[&:not([type='checkbox'])]:[font-variant:inherit] tw:[&:not([type='checkbox'])]:[font-weight:inherit] tw:[&:not([type='checkbox'])]:font-stretch-[inherit] tw:[&:not([type='checkbox'])]:[line-height:inherit] tw:[&:not([type='checkbox'])]:font-[inherit] tw:[&&]:[&:not([type='checkbox'])]:text-[12.5px] tw:[&:not([type='checkbox'])]:resize-y" v-model="bug.shot" type="checkbox" />Скриншот страницы</label>
        <label class="chk tw:inline-flex tw:items-center tw:gap-5"><input class="tw:[&:not([type='checkbox'])]:py-5 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-field tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:[font-style:inherit] tw:[&:not([type='checkbox'])]:[font-variant:inherit] tw:[&:not([type='checkbox'])]:[font-weight:inherit] tw:[&:not([type='checkbox'])]:font-stretch-[inherit] tw:[&:not([type='checkbox'])]:[line-height:inherit] tw:[&:not([type='checkbox'])]:font-[inherit] tw:[&&]:[&:not([type='checkbox'])]:text-[12.5px] tw:[&:not([type='checkbox'])]:resize-y" v-model="bug.openAfter" type="checkbox" />Открыть</label>
      </div>
      <p class="ck-hint tw:m-0 tw:text-muted tw:text-[11px] tw:leading-[1.45]">В запись войдут: найденное ({{ pickedList.length }}), запросы — блоками, которые можно запустить снова, ответы{{ bug.shot ? ', скриншот' : '' }}. Дальше историю ведите в этой же заметке.</p>
      <div class="ck-fb tw:flex tw:justify-end tw:gap-6">
        <button @click="bug = undefined">Отмена</button>
        <button class="primary tw:inline-flex tw:items-center tw:gap-6" :disabled="busy || !bug.title.trim()" @click="makeBug">{{ busy ? 'Создаю…' : 'Создать' }}</button>
      </div>
    </div>
  </div>
</template>
