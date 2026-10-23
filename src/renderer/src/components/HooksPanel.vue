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
/** The main process's news of hooks: the event → where it goes. */
const HOOK_EVENTS: Record<string, (p: unknown) => void> = {
  hooks: (p) => (hooks.value = p as BrowserHook[]),
  hookStatus: (p) => (status.value = p as HookStatus),
  // (the search's finds — of the hook open only)
  hookHits: (p) => {
    const h = p as { hookId: string; hits: HookHit[] }
    if (h.hookId === openId.value) hits.value = h.hits
  },
}
const off = window.qa.onBrowser((type, p) => {
  if (Object.hasOwn(HOOK_EVENTS, type)) HOOK_EVENTS[type](p)
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
  <div class="hp tw:flex tw:flex-col tw:gap-8 tw:min-h-0 tw:pt-8 tw:pr-10 tw:pb-12 tw:pl-10 tw:overflow-auto tw:text-[12.5px]">
    <!-- the search, always in sight -->
    <div class="hst tw:group/hst tw:flex tw:flex-col tw:gap-5 tw:py-7 tw:px-9 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg" :class="{ run: !!status.current, paused: status.paused }">
      <div class="hst-r tw:flex tw:items-center tw:gap-7 tw:min-w-0 tw:whitespace-nowrap">
        <i class="dot tw:w-8 tw:h-8 tw:rounded-[50%] tw:bg-muted tw:group-[.run]/hst:not-group-[.paused]/hst:bg-hook-live tw:group-[.run]/hst:animate-[HooksPanel-hblink_1s_ease-in-out_infinite] tw:group-[.paused]/hst:bg-hook-paused"></i>
        <b>{{ status.paused ? 'Поиск остановлен' : status.current ? 'Ищу' : 'Поиск ждёт ответов' }}</b>
        <span class="muted tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-muted tw:text-[11.5px]">в очереди {{ status.queued }} · проверено {{ status.scanned }} · пропущено {{ status.skipped }} · найдено {{ status.hits }}</span>
        <span class="grow tw:flex-1"></span>
        <button class="tw:inline-flex tw:flex-none tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text tw:text-[12px]" v-if="status.current" title="Пропустить этот ответ" @click="window_skip"><Icon name="chevronRight" :size="12" />Пропустить</button>
        <button class="tw:inline-flex tw:flex-none tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text tw:text-[12px]" v-if="!status.paused" title="Остановить поиск: очередь сбрасывается, новые ответы не берутся" @click="window_pause(true)"><Icon name="stop" :size="11" />Стоп</button>
        <button v-else class="go tw:inline-flex tw:flex-none tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:text-[12px] tw:[&&]:border-accent tw:bg-accent tw:text-on-accent" title="Искать снова" @click="window_pause(false)"><Icon name="play" :size="11" />Продолжить</button>
      </div>
      <div v-if="status.current" class="cur tw:grid tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-center tw:gap-y-4 tw:gap-x-7 tw:text-[11.5px]" :title="status.current.url">
        <span class="ty tw:py-0 tw:px-5 tw:rounded-[4px] tw:bg-hover tw:text-text-2 tw:font-data tw:text-[10.5px]">{{ status.current.type }}</span>
        <span class="u tw:min-w-0 tw:overflow-hidden tw:font-data tw:text-ellipsis tw:whitespace-nowrap">{{ shortUrl(status.current.url) }}</span>
        <span class="muted tw:text-muted tw:text-[11.5px]">{{ kb(status.current.size) }} · {{ pct }}% · {{ hookName(status.current.hookId) }}</span>
        <span class="bar tw:col-span-full tw:h-3 tw:rounded-[2px] tw:bg-border tw:overflow-hidden"><i class="tw:block tw:h-full tw:bg-hook-live" :style="{ width: `${pct}%` }"></i></span>
      </div>
      <p v-if="status.note" class="note tw:m-0 tw:overflow-hidden tw:text-muted tw:text-[11px] tw:text-ellipsis tw:whitespace-nowrap" :title="status.note">{{ status.note }}</p>
    </div>

    <template v-if="!draft">
      <button class="new tw:inline-flex tw:flex-none tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text tw:text-[12px] tw:disabled:opacity-45 tw:self-start tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :disabled="!host" :title="host ? '' : 'Откройте страницу сайта'" @click="create"><Icon name="plus" :size="13" />Хук для {{ host || 'сайта' }}</button>
      <p v-if="here.length" class="cap tw:flex tw:items-center tw:gap-6 tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[11px] tw:tracking-[0.04em] tw:uppercase">Для этого сайта</p>
      <div v-for="h in here" :key="h.id" class="hi tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-8 tw:border tw:border-border tw:rounded-[6px] tw:cursor-pointer tw:hover:bg-hover" @click="open(h)">
        <input type="checkbox" :checked="h.on" title="Включён" @click.stop="toggle(h)" />
        <span class="hn tw:flex tw:flex-1 tw:flex-col tw:min-w-0">{{ h.name }}</span>
        <span class="tags tw:inline-flex tw:gap-3"><i class="tw:py-0 tw:px-5 tw:rounded-[4px] tw:bg-hover tw:text-text-2 tw:text-[10.5px] tw:not-italic" v-if="h.css.trim()">CSS</i><i class="tw:py-0 tw:px-5 tw:rounded-[4px] tw:bg-hover tw:text-text-2 tw:text-[10.5px] tw:not-italic" v-if="h.js.trim()">JS</i><i v-if="h.search.on && h.search.query" class="s tw:py-0 tw:px-5 tw:rounded-[4px] tw:text-[10.5px] tw:not-italic tw:bg-hook-live/18 tw:text-hook-live">поиск</i></span>
      </div>
      <p v-if="other.length" class="cap tw:flex tw:items-center tw:gap-6 tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[11px] tw:tracking-[0.04em] tw:uppercase">Другие сайты</p>
      <div v-for="h in other" :key="h.id" class="hi tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-8 tw:border tw:border-border tw:rounded-[6px] tw:cursor-pointer tw:hover:bg-hover" @click="open(h)">
        <input type="checkbox" :checked="h.on" title="Включён" @click.stop="toggle(h)" />
        <span class="hn tw:flex tw:flex-1 tw:flex-col tw:min-w-0">{{ h.name }}<small class="tw:overflow-hidden tw:text-muted tw:text-[11px] tw:text-ellipsis tw:whitespace-nowrap">{{ h.site }}</small></span>
        <span class="tags tw:inline-flex tw:gap-3"><i class="tw:py-0 tw:px-5 tw:rounded-[4px] tw:bg-hover tw:text-text-2 tw:text-[10.5px] tw:not-italic" v-if="h.css.trim()">CSS</i><i class="tw:py-0 tw:px-5 tw:rounded-[4px] tw:bg-hover tw:text-text-2 tw:text-[10.5px] tw:not-italic" v-if="h.js.trim()">JS</i><i v-if="h.search.on && h.search.query" class="s tw:py-0 tw:px-5 tw:rounded-[4px] tw:text-[10.5px] tw:not-italic tw:bg-hook-live/18 tw:text-hook-live">поиск</i></span>
      </div>
      <p v-if="!hooks.length" class="empty tw:my-4 tw:mx-0 tw:text-muted tw:text-[12px] tw:leading-[1.5]">
        Хук привязан к сайту: его CSS и JS ставятся на каждую страницу (скрыть баннер, фон, отключить что-то), а поиск смотрит в ответы сайта — fetch / XHR, HTML, JS — в отдельном процессе. Найденное сохраняется.
      </p>
    </template>

    <template v-else>
      <div class="eh tw:flex tw:items-center tw:gap-6">
        <button class="back tw:inline-flex tw:items-center tw:justify-center tw:h-26 tw:min-w-26 tw:py-0 tw:px-4 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="К списку" @click="(draft = undefined), (openId = undefined)"><Icon name="chevronLeft" :size="14" /></button>
        <input v-model="draft.name" class="name tw:flex-1 tw:min-w-0 tw:h-28 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:font-semibold" spellcheck="false" />
        <label class="chk tw:inline-flex tw:items-center tw:gap-4 tw:text-text-2 tw:text-[12px] tw:whitespace-nowrap" title="Хук включён"><input v-model="draft.on" type="checkbox" />вкл</label>
        <button class="del tw:inline-flex tw:items-center tw:justify-center tw:h-26 tw:min-w-26 tw:py-0 tw:px-4 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Удалить хук" @click="remove"><Icon name="trash" :size="13" /></button>
      </div>
      <label class="fl tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px]">Сайт<input class="tw:h-26 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:font-data tw:text-[12px]" v-model="draft.site" spellcheck="false" placeholder="app.example.com · *.example.com · https://site/путь" /></label>

      <p class="cap tw:flex tw:items-center tw:gap-6 tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[11px] tw:tracking-[0.04em] tw:uppercase">CSS — на каждой странице сайта</p>
      <div class="ed"><CodeArea v-model="draft.css" lang="css" :min-height="60" placeholder=".banner, .promo { display: none !important }" /></div>
      <p class="cap tw:flex tw:items-center tw:gap-6 tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[11px] tw:tracking-[0.04em] tw:uppercase">JS — выполняется на странице, когда она готова</p>
      <div class="ed"><CodeArea v-model="draft.js" lang="javascript" :min-height="60" placeholder="document.querySelector('.ad')?.remove()" /></div>

      <p class="cap tw:flex tw:items-center tw:gap-6 tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[11px] tw:tracking-[0.04em] tw:uppercase">Поиск в ответах</p>
      <div class="srch tw:flex tw:items-end tw:gap-8">
        <label class="chk tw:inline-flex tw:items-center tw:gap-4 tw:text-text-2 tw:text-[12px] tw:whitespace-nowrap"><input v-model="draft.search.on" type="checkbox" />искать</label>
        <input v-model="draft.search.query" class="q tw:h-26 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:font-data tw:text-[12px] tw:flex-1 tw:min-w-0" spellcheck="false" :placeholder="draft.search.regex ? '/token&quot;:&quot;(\\w+)/' : 'текст для поиска'" />
        <label class="chk tw:inline-flex tw:items-center tw:gap-4 tw:text-text-2 tw:text-[12px] tw:whitespace-nowrap" title="Регулярное выражение (/…/flags)"><input v-model="draft.search.regex" type="checkbox" />.*</label>
        <label class="chk tw:inline-flex tw:items-center tw:gap-4 tw:text-text-2 tw:text-[12px] tw:whitespace-nowrap" title="Учитывать регистр"><input v-model="draft.search.caseSensitive" type="checkbox" />Aa</label>
      </div>
      <div class="types tw:flex tw:flex-wrap tw:gap-4">
        <label v-for="t in HOOK_TYPES" :key="t.id" class="chip tw:inline-flex tw:items-center tw:gap-4 tw:py-2 tw:px-8 tw:border tw:border-border-2 tw:rounded-[12px] tw:text-muted tw:text-[11.5px] tw:cursor-pointer tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/16 tw:[&.on]:text-accent-fg" :class="{ on: draft.search.types.includes(t.id) }"><input class="tw:hidden" type="checkbox" :checked="draft.search.types.includes(t.id)" @change="setType(t.id, ($event.target as HTMLInputElement).checked)" />{{ t.label }}</label>
      </div>
      <div class="srch tw:flex tw:items-end tw:gap-8">
        <label class="fl sm tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px] tw:flex-1">Адрес содержит<input class="tw:h-26 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:font-data tw:text-[12px]" v-model="draft.search.urlHas" spellcheck="false" placeholder="/api/ (пусто — любые)" /></label>
        <label class="fl xs tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px] tw:w-100">Не больше, МБ<input class="tw:h-26 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:font-data tw:text-[12px]" v-model.number="draft.search.maxMb" type="number" min="1" max="200" /></label>
      </div>

      <div class="acts tw:flex tw:items-center tw:gap-6">
        <button class="pri tw:inline-flex tw:flex-none tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:text-[12px] tw:[&&]:border-accent tw:bg-accent tw:text-on-accent tw:disabled:opacity-45" :disabled="!dirty" @click="save(true)"><Icon name="check" :size="13" />Сохранить и обновить страницу</button>
        <button class="tw:inline-flex tw:flex-none tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text tw:text-[12px] tw:disabled:opacity-45" :disabled="!dirty" @click="save()">Сохранить</button>
        <span class="ok tw:text-hook-saved tw:text-[11.5px]">{{ msg }}</span>
      </div>

      <p class="cap tw:flex tw:items-center tw:gap-6 tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[11px] tw:tracking-[0.04em] tw:uppercase">Найдено <b>{{ hits.length }}</b><span class="grow tw:flex-1"></span><button v-if="hits.length" class="lk tw:inline-flex tw:items-center tw:justify-center tw:min-w-26 tw:py-0 tw:px-4 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-muted tw:h-20 tw:text-[11px] tw:normal-case tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="copyHits">копировать</button><button v-if="hits.length" class="lk tw:inline-flex tw:items-center tw:justify-center tw:min-w-26 tw:py-0 tw:px-4 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-muted tw:h-20 tw:text-[11px] tw:normal-case tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="window_clear">очистить</button></p>
      <div class="hits tw:flex tw:flex-col tw:gap-4">
        <div v-for="h in hits" :key="h.id" class="hit tw:flex tw:flex-col tw:gap-3 tw:py-5 tw:px-7 tw:border tw:border-border tw:rounded-[6px] tw:cursor-copy tw:hover:bg-hover" :title="`${h.method} ${h.url}\nстрока ${h.line}, символ ${h.col} · ${new Date(h.at).toLocaleString('ru-RU')}`" @click="copyUrl(h.url)">
          <div class="hh tw:flex tw:items-center tw:gap-6 tw:min-w-0"><span class="ty tw:py-0 tw:px-5 tw:rounded-[4px] tw:bg-hover tw:text-text-2 tw:font-data tw:text-[10.5px]">{{ h.type }}</span><span v-if="h.status" class="muted tw:text-muted tw:text-[11.5px]">{{ h.status }}</span><span class="u tw:min-w-0 tw:overflow-hidden tw:font-data tw:text-ellipsis tw:whitespace-nowrap tw:flex-1">{{ shortUrl(h.url) }}</span><span class="muted tw:text-muted tw:text-[11.5px]">{{ h.line }}:{{ h.col }}</span></div>
          <code class="sn tw:overflow-hidden tw:text-text-2 tw:font-data tw:text-[11px] tw:text-ellipsis tw:whitespace-nowrap">{{ h.snippet.slice(0, h.mAt) }}<mark class="tw:rounded-[2px] tw:bg-hook-match/35 tw:text-text">{{ h.snippet.slice(h.mAt, h.mAt + h.mLen) }}</mark>{{ h.snippet.slice(h.mAt + h.mLen) }}</code>
        </div>
        <p v-if="!hits.length" class="empty tw:my-4 tw:mx-0 tw:text-muted tw:text-[12px] tw:leading-[1.5]">{{ draft.search.on && draft.search.query ? 'Пока ничего — откройте или обновите страницы сайта' : 'Включите поиск и задайте, что искать' }}</p>
      </div>
    </template>
  </div>
</template>


<style scoped src="./HooksPanel.css"></style>
