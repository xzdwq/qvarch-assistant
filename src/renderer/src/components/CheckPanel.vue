<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CHECK_KINDS, CHECK_STEPS, kindMeta, reqLine, type CheckKind, type CheckProblem, type CheckSev } from '@shared/check'
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
const SEV: Array<{ id: CheckSev; label: string }> = [
  { id: 'high', label: 'Важные' },
  { id: 'mid', label: 'Средние' },
  { id: 'low', label: 'Мелкие' },
]
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
  <div class="ck">
    <!-- on / off -->
    <div class="ck-top" :class="{ on: st.on }">
      <button class="ck-sw" role="switch" :aria-checked="st.on" :title="st.on ? 'Выключить слежение' : 'Включить слежение'" @click="set({ on: !st.on })"><i></i></button>
      <div class="ck-st">
        <b>{{ st.on ? 'Слежу за вкладками' : 'Слежение выключено' }}</b>
        <small>{{ st.on ? 'Работайте как обычно — найденное появится ниже' : 'Включите — и ошибки сети, страницы и консоли будут ловиться сами' }}</small>
      </div>
      <button class="ib" :class="{ on: gear }" title="Что проверять" @click="gear = !gear"><Icon name="settings" :size="14" /></button>
      <button class="ib" :disabled="!shown.length" title="Очистить показанные" @click="clearAll"><Icon name="trash" :size="14" /></button>
    </div>
    <div class="ck-steps">
      <template v-if="stepsOn">
        <span class="ck-rec"><i></i>Записываю шаги: {{ pwRec?.count ?? 0 }}</span>
        <span class="grow"></span>
        <button @click="stopPwRec(true)">Отменить</button>
        <button class="primary" @click="stopPwRec()">Стоп</button>
      </template>
      <template v-else-if="checkSteps">
        <span class="ck-ok"><Icon name="check" :size="12" />Шаги записаны: {{ checkSteps.lines.length }} — войдут в запись журнала</span>
        <span class="grow"></span>
        <button class="lnk" @click="checkSteps = undefined">убрать</button>
        <button v-if="!bug && !picked.size" class="primary" @click="startBug"><Icon name="note" :size="12" />В журнал</button>
      </template>
      <template v-else>
        <button :disabled="!canRecord" :title="canRecord ? 'Записать, что вы делаете на этой вкладке, — шаги и сценарий войдут в запись журнала' : pwRec ? 'Уже идёт запись' : 'Откройте страницу сайта'" @click="recordSteps"><i class="ck-dot"></i>Записать шаги</button>
        <span class="grow"></span>
        <button title="Новая запись в журнал (без найденного) — сценарий, наблюдение, баг" @click="startBug"><Icon name="plus" :size="12" />Новая запись</button>
      </template>
    </div>
    <p v-if="blockedHere && st.on" class="ck-warn"><Icon name="lock" :size="12" />На этой вкладке открыты инструменты разработчика — слежение начнётся, когда их закроете.</p>

    <!-- what is checked -->
    <div v-if="gear" class="ck-set">
      <div v-for="s in SEV" :key="s.id" class="ck-grp">
        <span class="ck-gl" :class="s.id">{{ s.label }}</span>
        <label v-for="k in CHECK_KINDS.filter((x) => x.sev === s.id)" :key="k.id" :title="k.hint"><input type="checkbox" :checked="!st.off.includes(k.id)" @change="toggleKind(k.id)" />{{ k.label }}</label>
      </div>
      <div class="ck-nums">
        <label>Медленный запрос, с <input type="number" min="1" max="120" :value="st.slowMs / 1000" @change="set({ slowMs: Math.max(1, Number(($event.target as HTMLInputElement).value)) * 1000 })" /></label>
        <label>Долгая загрузка, с <input type="number" min="2" max="300" :value="st.loadingMs / 1000" @change="set({ loadingMs: Math.max(2, Number(($event.target as HTMLInputElement).value)) * 1000 })" /></label>
        <label title="Счётчики, карты, шрифты и прочие чужие сайты"><input type="checkbox" :checked="st.allSites" @change="set({ allSites: !st.allSites })" />Запросы других сайтов тоже</label>
        <button v-if="st.mutes.length" class="lnk" title="Снова показывать всё скрытое" @click="set({ mutes: [] })">Скрыто: {{ st.mutes.length }} — вернуть</button>
      </div>
    </div>

    <!-- importance, this tab, search -->
    <div class="ck-flt">
      <button :class="{ on: !sev }" @click="sev = ''">Все <b>{{ base.length }}</b></button>
      <button v-for="s in SEV" :key="s.id" :class="[s.id, { on: sev === s.id }]" @click="sev = sev === s.id ? '' : s.id"><i></i>{{ s.label }} <b>{{ countOf(s.id) }}</b></button>
      <span class="grow"></span>
      <button :class="{ on: onlyTab }" title="Только эта вкладка" @click="onlyTab = !onlyTab"><Icon name="browser" :size="12" /></button>
    </div>
    <label class="ck-q"><Icon name="search" :size="12" /><input v-model="q" placeholder="Поиск по найденному" spellcheck="false" /></label>

    <p v-if="made" class="ck-made"><Icon name="check" :size="12" />Записано в журнал: <a href="#" @click.prevent="openNote(made.path)">{{ made.name }}</a><button class="ib" @click="made = undefined"><Icon name="x" :size="11" /></button></p>

    <!-- the findings -->
    <div class="ck-list">
      <div v-if="!shown.length" class="ck-empty">
        <Icon name="bug" :size="26" />
        <template v-if="!st.on">
          <p>Включите слежение и работайте с сайтом как обычно. Сюда попадут ошибки сервера, пустые id в запросах, двойные отправки, сообщения об ошибках, «несохранённые изменения» после сохранения, вечные загрузки, вылезающий текст и ошибки консоли.</p>
          <button class="primary" @click="set({ on: true })">Включить</button>
        </template>
        <p v-else>Пока всё чисто.</p>
      </div>
      <div v-for="p in shown" :key="p.id" class="ck-it" :class="[p.sev, { open: open === p.id, done: !!p.note }]">
        <div class="ck-row" @click="open = open === p.id ? undefined : p.id">
          <input type="checkbox" :checked="picked.has(p.id)" :title="'Выбрать для журнала'" @click.stop="pick(p.id)" />
          <span class="ck-ic"><Icon :name="ICON[p.kind]" :size="13" /></span>
          <span class="ck-tx">
            <span class="ck-t">{{ p.title }}</span>
            <small>{{ kindMeta(p.kind).label }} · {{ where(p.page) }} · {{ time(p.last) }}</small>
          </span>
          <b v-if="p.count > 1" class="ck-n" :title="`Повторялось ${p.count} раз`">×{{ p.count }}</b>
          <a v-if="p.note" href="#" class="ck-bug" title="Открыть запись журнала" @click.stop.prevent="openNote(p.note)"><Icon name="note" :size="11" />в журнале</a>
        </div>
        <div v-if="open === p.id" class="ck-det">
          <pre v-if="p.detail" class="ck-d">{{ p.detail }}</pre>
          <template v-if="p.req">
            <div class="ck-req"><b>{{ reqLine(p.req) }}</b><span v-if="p.req.ms !== undefined">{{ p.req.ms }} мс</span></div>
            <div class="ck-url" :title="p.req.url">{{ p.req.url }}</div>
            <div v-if="p.req.reqBody || p.req.resBody" class="ck-bt">
              <button :class="{ on: bodyTab === 'req' }" :disabled="!p.req.reqBody" @click="bodyTab = 'req'">Запрос</button>
              <button :class="{ on: bodyTab === 'res' }" :disabled="!p.req.resBody" @click="bodyTab = 'res'">Ответ</button>
            </div>
            <pre v-if="bodyTab === 'req' && p.req.reqBody" class="ck-body">{{ pretty(p.req.reqBody) }}</pre>
            <pre v-else-if="p.req.resBody" class="ck-body">{{ pretty(p.req.resBody) }}</pre>
          </template>
          <div class="ck-acts">
            <button @click="show(p)"><Icon name="eye" :size="12" />{{ p.selector ? 'Показать на странице' : 'К вкладке' }}</button>
            <button @click="pick(p.id)"><Icon name="note" :size="12" />{{ picked.has(p.id) ? 'Не в журнал' : 'В журнал' }}</button>
            <span class="grow"></span>
            <button title="Больше не показывать такие находки" @click="mute(p)"><Icon name="eyeOff" :size="12" />Не показывать такие</button>
            <button title="Убрать из списка" @click="forget(p)"><Icon name="x" :size="12" /></button>
          </div>
        </div>
      </div>
    </div>

    <!-- a bug from the picked -->
    <div v-if="picked.size && !bug" class="ck-foot">
      <span>Выбрано: <b>{{ picked.size }}</b></span>
      <button class="lnk" @click="picked = new Set()">снять</button>
      <span class="grow"></span>
      <button class="primary" @click="startBug"><Icon name="note" :size="13" />В журнал</button>
    </div>
    <div v-if="bug" class="ck-form">
      <div class="ck-fh"><Icon name="note" :size="14" /><b>Запись в журнал</b><span class="grow"></span><button class="ib" @click="bug = undefined"><Icon name="x" :size="13" /></button></div>
      <label>Название<input v-model="bug.title" spellcheck="false" /></label>
      <label>Шаги<textarea v-model="bug.steps" rows="3"></textarea></label>
      <label>Ожидаемый результат <small>необязательно</small><textarea v-model="bug.expected" rows="2" placeholder="Что должно было произойти"></textarea></label>
      <label>Фактический результат <small>необязательно</small><textarea v-model="bug.actual" rows="3"></textarea></label>
      <div class="ck-fr">
        <label class="ck-fold">Папка<input v-model="bug.folder" spellcheck="false" /></label>
        <label class="chk"><input v-model="bug.shot" type="checkbox" />Скриншот страницы</label>
        <label class="chk"><input v-model="bug.openAfter" type="checkbox" />Открыть</label>
      </div>
      <p class="ck-hint">В запись войдут: найденное ({{ pickedList.length }}), запросы — блоками, которые можно запустить снова, ответы{{ bug.shot ? ', скриншот' : '' }}. Дальше историю ведите в этой же заметке.</p>
      <div class="ck-fb">
        <button @click="bug = undefined">Отмена</button>
        <button class="primary" :disabled="busy || !bug.title.trim()" @click="makeBug">{{ busy ? 'Создаю…' : 'Создать' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ck {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 8px;
  padding: 10px;
  font-size: 12.5px;
}
.ck-top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--panel-2);
}
.ck-top.on {
  border-color: rgb(var(--accent-rgb) / 0.5);
}
.ck-sw {
  position: relative;
  flex: none;
  width: 36px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: var(--panel-3);
}
.ck-sw i {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--muted);
  transition: left 0.15s;
}
.ck-top.on .ck-sw {
  background: var(--accent);
}
.ck-top.on .ck-sw i {
  left: 19px;
  background: #fff;
}
.ck-st {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.ck-st b,
.ck-st small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ck-st small {
  color: var(--muted);
  font-size: 11px;
}
.ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.ib.on,
.ib:hover:not(:disabled) {
  color: var(--text);
  background: var(--hover);
}
.ck-steps {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ck-steps button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
}
.ck-dot,
.ck-rec i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--down);
}
.ck-rec {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--down-fg);
  font-weight: 600;
}
.ck-rec i {
  animation: ckblink 1s infinite;
}
@keyframes ckblink {
  50% {
    opacity: 0.25;
  }
}
.ck-ok {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--up-fg);
}
.ck-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--warn-fg);
  font-size: 11.5px;
}
.ck-set {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
}
.ck-grp {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ck-grp label,
.ck-nums label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ck-gl {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.ck-gl.high,
.ck-flt .high i,
.ck-it.high .ck-ic {
  color: var(--down-fg);
}
.ck-gl.mid,
.ck-flt .mid i,
.ck-it.mid .ck-ic {
  color: var(--warn-fg);
}
.ck-gl.low,
.ck-flt .low i,
.ck-it.low .ck-ic {
  color: var(--info-fg);
}
.ck-nums {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}
.ck-nums input[type='number'] {
  width: 56px;
}
.ck-flt {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ck-flt button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: transparent;
  color: var(--text-2);
  font-size: 11.5px;
}
.ck-flt button i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
.ck-flt button.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
  background: rgb(var(--accent-rgb) / 0.14);
  color: var(--text);
}
.ck-flt b {
  font-weight: 600;
}
.grow {
  flex: 1;
}
.ck-q {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--muted);
}
.ck-q input {
  flex: 1;
  height: 26px;
  border: 0;
  background: transparent;
  color: var(--text);
  outline: none;
}
.ck-made {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--up-fg);
}
.ck-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  overflow: auto;
}
.ck-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 24px 12px;
  color: var(--muted);
  text-align: center;
  line-height: 1.5;
}
.ck-it {
  border: 1px solid var(--border);
  border-left: 3px solid var(--border-2);
  border-radius: 4px;
  background: var(--panel);
}
.ck-it.high {
  border-left-color: var(--down);
}
.ck-it.mid {
  border-left-color: var(--warn);
}
.ck-it.low {
  border-left-color: var(--info, #448aff);
}
.ck-it.done {
  opacity: 0.6;
}
.ck-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  cursor: pointer;
}
.ck-row:hover {
  background: var(--hover);
}
.ck-ic {
  display: inline-flex;
  flex: none;
}
.ck-tx {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.ck-t {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ck-tx small {
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ck-n {
  flex: none;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--hover);
  color: var(--text-2);
  font-size: 11px;
}
.ck-bug {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  color: var(--accent-fg);
  font-size: 11px;
}
.ck-det {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 10px 10px 30px;
}
.ck-d,
.ck-body {
  margin: 0;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--panel-2);
  font-family: var(--font-data);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.ck-body {
  max-height: 240px;
  overflow: auto;
}
.ck-req {
  display: flex;
  gap: 10px;
  font-family: var(--font-data);
}
.ck-req span,
.ck-url {
  color: var(--muted);
  font-size: 11px;
}
.ck-url {
  overflow: hidden;
  font-family: var(--font-data);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ck-bt {
  display: flex;
  gap: 2px;
}
.ck-bt button,
.ck-acts button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  font-size: 11.5px;
}
.ck-bt button.on {
  background: rgb(var(--accent-rgb) / 0.18);
  color: var(--accent-fg);
}
.ck-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ck-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.ck-foot .primary,
.ck-fb .primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lnk {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-fg);
  font-size: 11.5px;
}
.ck-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid rgb(var(--accent-rgb) / 0.5);
  border-radius: var(--r3);
  background: var(--panel-2);
}
.ck-fh {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ck-form > label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--text-2);
  font-size: 11.5px;
}
.ck-form input:not([type='checkbox']),
.ck-form textarea {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  resize: vertical;
}
.ck-fr {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}
.ck-fold {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 120px;
  color: var(--text-2);
  font-size: 11.5px;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.ck-hint {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.45;
}
.ck-fb {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
