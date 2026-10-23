<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { HOOK_TYPES, siteMatch, type BrowserHook, type HookHit, type HookResType, type HookStatus } from '@shared/hooks'
import CodeArea from './CodeArea.vue'
import Icon from './Icon.vue'

/**
 * The Браузер's hooks (a side panel): each tied to a site — its CSS and JS go onto every page there, its search
 * looks into the site's answers in a process of its own (the status always shown: what is looked into now, the
 * queue; «Пропустить» this one, «Стоп» everything). What it finds is kept.
 */
const props = defineProps<{ url?: string; tabId?: string }>()
const hooks = shallowRef<BrowserHook[]>([])
const status = ref<HookStatus>({ paused: false, queued: 0, scanned: 0, skipped: 0, hits: 0 })
const hits = shallowRef<HookHit[]>([])
const openId = ref<string>()
const draft = ref<BrowserHook>()
const msg = ref('')

void window.qa.browser('hooksList').then((l) => (hooks.value = l))
void window.qa.browser('hookStatus').then((s) => (status.value = s))
const off = window.qa.onBrowser((type, p) => {
  if (type === 'hooks') hooks.value = p as BrowserHook[]
  else if (type === 'hookStatus') status.value = p as HookStatus
  else if (type === 'hookHits') {
    const h = p as { hookId: string; hits: HookHit[] }
    if (h.hookId === openId.value) hits.value = h.hits
  }
})
onBeforeUnmount(off)

const host = computed(() => {
  try {
    const u = new URL(props.url ?? '')
    return /^https?:$/.test(u.protocol) ? u.host : ''
  } catch {
    return ''
  }
})
const here = computed(() => hooks.value.filter((h) => props.url && siteMatch(h.site, props.url)))
const other = computed(() => hooks.value.filter((h) => !here.value.includes(h)))

function open(h: BrowserHook): void {
  openId.value = h.id
  draft.value = JSON.parse(JSON.stringify(h)) as BrowserHook
  hits.value = []
  void window.qa.browser('hookHits', h.id).then((l) => openId.value === h.id && (hits.value = l))
}
async function create(): Promise<void> {
  const h = await window.qa.browser('hookPut', { site: host.value, name: host.value ? `Хук ${host.value}` : 'Новый хук' })
  open(h)
}
const dirty = computed(() => {
  const d = draft.value
  const h = hooks.value.find((x) => x.id === d?.id)
  return !!d && !!h && JSON.stringify(d) !== JSON.stringify(h)
})
async function save(reload = false): Promise<void> {
  if (!draft.value) return
  const h = await window.qa.browser('hookPut', JSON.parse(JSON.stringify(draft.value)) as BrowserHook)
  draft.value = JSON.parse(JSON.stringify(h)) as BrowserHook
  if (reload && props.tabId && props.url && siteMatch(h.site, props.url)) window.qa.browser('hookReapply', props.tabId)
  flash(reload ? 'Сохранено — страница обновлена' : 'Сохранено')
}
async function toggle(h: BrowserHook): Promise<void> {
  const n = await window.qa.browser('hookPut', { id: h.id, on: !h.on })
  if (draft.value?.id === h.id) draft.value.on = n.on
}
async function remove(): Promise<void> {
  const d = draft.value
  if (!d || !confirm(`Удалить хук «${d.name}» и всё, что он нашёл?`)) return
  await window.qa.browser('hookRemove', d.id)
  draft.value = undefined
  openId.value = undefined
}
function flash(t: string): void {
  msg.value = t
  setTimeout(() => msg.value === t && (msg.value = ''), 2500)
}
function setType(t: HookResType, on: boolean): void {
  const s = draft.value!.search
  s.types = on ? [...new Set([...s.types, t])] : s.types.filter((x) => x !== t)
}
const kb = (n: number) => (n < 1024 ? `${n} Б` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`)
const pct = computed(() => (status.value.current ? Math.round((status.value.current.done / Math.max(1, status.value.current.size)) * 100) : 0))
const shortUrl = (u: string) => u.replace(/^https?:\/\/[^/]+/, '') || u
const hookName = (id: string) => hooks.value.find((h) => h.id === id)?.name ?? ''
async function copyHits(): Promise<void> {
  const d = draft.value
  if (!d) return
  const text = [`Хук «${d.name}» (${d.site}) · поиск: ${d.search.query} · найдено: ${hits.value.length}`, ...hits.value.map((h) => `${h.method} ${h.url} [${h.type}${h.status ? ` ${h.status}` : ''}] строка ${h.line}:${h.col}\n  …${h.snippet}…`)].join('\n')
  await navigator.clipboard.writeText(text)
  flash('Найденное скопировано')
}
const window_skip = () => void window.qa.browser('hookSkip')
const window_pause = (on: boolean) => void window.qa.browser('hookPause', on)
const window_clear = () => draft.value && void window.qa.browser('hookClearHits', draft.value.id)
const copyUrl = (u: string) => void navigator.clipboard.writeText(u).then(() => flash('Адрес скопирован'))
// a hook of another page opened, its site's page shown: the list follows
watch(
  () => props.url,
  () => {
    if (!draft.value && here.value.length === 1) open(here.value[0])
  },
)
</script>

<template>
  <div class="hp">
    <!-- the search, always in sight -->
    <div class="hst" :class="{ run: !!status.current, paused: status.paused }">
      <div class="hst-r">
        <i class="dot"></i>
        <b>{{ status.paused ? 'Поиск остановлен' : status.current ? 'Ищу' : 'Поиск ждёт ответов' }}</b>
        <span class="muted">в очереди {{ status.queued }} · проверено {{ status.scanned }} · пропущено {{ status.skipped }} · найдено {{ status.hits }}</span>
        <span class="grow"></span>
        <button v-if="status.current" title="Пропустить этот ответ" @click="window_skip"><Icon name="chevronRight" :size="12" />Пропустить</button>
        <button v-if="!status.paused" title="Остановить поиск: очередь сбрасывается, новые ответы не берутся" @click="window_pause(true)"><Icon name="stop" :size="11" />Стоп</button>
        <button v-else class="go" title="Искать снова" @click="window_pause(false)"><Icon name="play" :size="11" />Продолжить</button>
      </div>
      <div v-if="status.current" class="cur" :title="status.current.url">
        <span class="ty">{{ status.current.type }}</span>
        <span class="u">{{ shortUrl(status.current.url) }}</span>
        <span class="muted">{{ kb(status.current.size) }} · {{ pct }}% · {{ hookName(status.current.hookId) }}</span>
        <span class="bar"><i :style="{ width: `${pct}%` }"></i></span>
      </div>
      <p v-if="status.note" class="note" :title="status.note">{{ status.note }}</p>
    </div>

    <template v-if="!draft">
      <button class="new" :disabled="!host" :title="host ? '' : 'Откройте страницу сайта'" @click="create"><Icon name="plus" :size="13" />Хук для {{ host || 'сайта' }}</button>
      <p v-if="here.length" class="cap">Для этого сайта</p>
      <div v-for="h in here" :key="h.id" class="hi" @click="open(h)">
        <input type="checkbox" :checked="h.on" title="Включён" @click.stop="toggle(h)" />
        <span class="hn">{{ h.name }}</span>
        <span class="tags"><i v-if="h.css.trim()">CSS</i><i v-if="h.js.trim()">JS</i><i v-if="h.search.on && h.search.query" class="s">поиск</i></span>
      </div>
      <p v-if="other.length" class="cap">Другие сайты</p>
      <div v-for="h in other" :key="h.id" class="hi" @click="open(h)">
        <input type="checkbox" :checked="h.on" title="Включён" @click.stop="toggle(h)" />
        <span class="hn">{{ h.name }}<small>{{ h.site }}</small></span>
        <span class="tags"><i v-if="h.css.trim()">CSS</i><i v-if="h.js.trim()">JS</i><i v-if="h.search.on && h.search.query" class="s">поиск</i></span>
      </div>
      <p v-if="!hooks.length" class="empty">
        Хук привязан к сайту: его CSS и JS ставятся на каждую страницу (скрыть баннер, фон, отключить что-то), а поиск смотрит в ответы сайта — fetch / XHR, HTML, JS — в отдельном процессе. Найденное сохраняется.
      </p>
    </template>

    <template v-else>
      <div class="eh">
        <button class="back" title="К списку" @click="(draft = undefined), (openId = undefined)"><Icon name="chevronLeft" :size="14" /></button>
        <input v-model="draft.name" class="name" spellcheck="false" />
        <label class="chk" title="Хук включён"><input v-model="draft.on" type="checkbox" />вкл</label>
        <button class="del" title="Удалить хук" @click="remove"><Icon name="trash" :size="13" /></button>
      </div>
      <label class="fl">Сайт<input v-model="draft.site" spellcheck="false" placeholder="app.example.com · *.example.com · https://site/путь" /></label>

      <p class="cap">CSS — на каждой странице сайта</p>
      <div class="ed"><CodeArea v-model="draft.css" lang="css" :min-height="60" placeholder=".banner, .promo { display: none !important }" /></div>
      <p class="cap">JS — выполняется на странице, когда она готова</p>
      <div class="ed"><CodeArea v-model="draft.js" lang="javascript" :min-height="60" placeholder="document.querySelector('.ad')?.remove()" /></div>

      <p class="cap">Поиск в ответах</p>
      <div class="srch">
        <label class="chk"><input v-model="draft.search.on" type="checkbox" />искать</label>
        <input v-model="draft.search.query" class="q" spellcheck="false" :placeholder="draft.search.regex ? '/token&quot;:&quot;(\\w+)/' : 'текст для поиска'" />
        <label class="chk" title="Регулярное выражение (/…/flags)"><input v-model="draft.search.regex" type="checkbox" />.*</label>
        <label class="chk" title="Учитывать регистр"><input v-model="draft.search.caseSensitive" type="checkbox" />Aa</label>
      </div>
      <div class="types">
        <label v-for="t in HOOK_TYPES" :key="t.id" class="chip" :class="{ on: draft.search.types.includes(t.id) }"><input type="checkbox" :checked="draft.search.types.includes(t.id)" @change="setType(t.id, ($event.target as HTMLInputElement).checked)" />{{ t.label }}</label>
      </div>
      <div class="srch">
        <label class="fl sm">Адрес содержит<input v-model="draft.search.urlHas" spellcheck="false" placeholder="/api/ (пусто — любые)" /></label>
        <label class="fl xs">Не больше, МБ<input v-model.number="draft.search.maxMb" type="number" min="1" max="200" /></label>
      </div>

      <div class="acts">
        <button class="pri" :disabled="!dirty" @click="save(true)"><Icon name="check" :size="13" />Сохранить и обновить страницу</button>
        <button :disabled="!dirty" @click="save()">Сохранить</button>
        <span class="ok">{{ msg }}</span>
      </div>

      <p class="cap">Найдено <b>{{ hits.length }}</b><span class="grow"></span><button v-if="hits.length" class="lk" @click="copyHits">копировать</button><button v-if="hits.length" class="lk" @click="window_clear">очистить</button></p>
      <div class="hits">
        <div v-for="h in hits" :key="h.id" class="hit" :title="`${h.method} ${h.url}\nстрока ${h.line}, символ ${h.col} · ${new Date(h.at).toLocaleString('ru-RU')}`" @click="copyUrl(h.url)">
          <div class="hh"><span class="ty">{{ h.type }}</span><span v-if="h.status" class="muted">{{ h.status }}</span><span class="u">{{ shortUrl(h.url) }}</span><span class="muted">{{ h.line }}:{{ h.col }}</span></div>
          <code class="sn">{{ h.snippet.slice(0, h.mAt) }}<mark>{{ h.snippet.slice(h.mAt, h.mAt + h.mLen) }}</mark>{{ h.snippet.slice(h.mAt + h.mLen) }}</code>
        </div>
        <p v-if="!hits.length" class="empty">{{ draft.search.on && draft.search.query ? 'Пока ничего — откройте или обновите страницы сайта' : 'Включите поиск и задайте, что искать' }}</p>
      </div>
    </template>
  </div>
</template>


<style scoped>
.hp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 8px 10px 12px;
  overflow: auto;
  font-size: 12.5px;
}
.hst {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 9px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
}
.hst-r {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  white-space: nowrap;
}
.hst-r .muted {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hst .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
}
.hst.run .dot {
  background: #34d399;
  animation: hblink 1s ease-in-out infinite;
}
.hst.paused .dot {
  background: #f87171;
}
@keyframes hblink {
  50% {
    opacity: 0.3;
  }
}
.hst button,
.acts button,
.new {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font-size: 12px;
}
.hst button.go,
.acts .pri {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent, #fff);
}
.acts button:disabled,
.new:disabled {
  opacity: 0.45;
}
.cur {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 7px;
  font-size: 11.5px;
}
.cur .bar {
  grid-column: 1 / -1;
  height: 3px;
  border-radius: 2px;
  background: var(--border);
  overflow: hidden;
}
.cur .bar i {
  display: block;
  height: 100%;
  background: #34d399;
}
.u {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-data);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ty {
  padding: 0 5px;
  border-radius: 4px;
  background: var(--hover);
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 10.5px;
}
.note {
  margin: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: var(--muted);
  font-size: 11.5px;
}
.grow {
  flex: 1;
}
.new {
  align-self: flex-start;
}
.cap {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.hi {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.hi:hover {
  background: var(--hover);
}
.hn {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.hn small {
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tags {
  display: inline-flex;
  gap: 3px;
}
.tags i {
  padding: 0 5px;
  border-radius: 4px;
  background: var(--hover);
  color: var(--text-2);
  font-size: 10.5px;
  font-style: normal;
}
.tags i.s {
  background: rgba(52, 211, 153, 0.18);
  color: #34d399;
}
.empty {
  margin: 4px 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}
.eh {
  display: flex;
  align-items: center;
  gap: 6px;
}
.eh .name {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-weight: 600;
}
.back,
.del,
.lk {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  min-width: 26px;
  padding: 0 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
}
.lk {
  height: 20px;
  font-size: 11px;
  text-transform: none;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
}
.fl {
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--muted);
  font-size: 11.5px;
}
.fl input,
.srch .q {
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12px;
}
.fl.sm {
  flex: 1;
}
.fl.xs {
  width: 100px;
}
.ed :deep(.cm-editor) {
  max-height: 240px;
}
.srch {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.srch .q {
  flex: 1;
  min-width: 0;
}
.types {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  color: var(--muted);
  font-size: 11.5px;
  cursor: pointer;
}
.chip input {
  display: none;
}
.chip.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
  background: rgb(var(--accent-rgb) / 0.16);
  color: var(--accent-fg);
}
.acts {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ok {
  color: #4ade80;
  font-size: 11.5px;
}
.hits {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hit {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: copy;
}
.hit:hover {
  background: var(--hover);
}
.hh {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.hh .u {
  flex: 1;
}
.sn {
  overflow: hidden;
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sn mark {
  border-radius: 2px;
  background: rgba(250, 204, 21, 0.35);
  color: var(--text);
}
</style>
