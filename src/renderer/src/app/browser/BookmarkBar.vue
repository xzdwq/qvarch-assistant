<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import { bookmarks, hostOf, recState } from '../../lib/browser'
import { useBrowserView } from './browserViewContext'

/**
 * The bar over the panes: the bookmarks (cut where the room ends — the buttons on the right always whole), the offer
 * to keep a password, a download's news, the side panel's button, the history, the saved passwords.
 */
const view = useBrowserView()
const { openUrl } = view.tabs
const { badIcon, bmDrag, folderPop, onBmMenu } = view.bookmarks
const { onBmDown, dropCls } = view.bookmarkDrag
const { pwAsk, pwReply, pwOpen } = view.passwords
const { download, reveal } = view.site
const { recOpen, checkNew, checkHigh } = view.side
const { openHistory } = view.history
</script>

<template>
  <div class="bbar tw:flex-none tw:flex tw:items-center tw:gap-2 tw:h-32 tw:py-0 tw:px-8 tw:border-b tw:border-b-border tw:bg-panel tw:overflow-hidden tw:whitespace-nowrap" @contextmenu.self.prevent="onBmMenu(undefined, $event)">
    <!-- the bookmarks take what is left and are cut there: the buttons on the right always whole -->
    <span class="bms tw:flex tw:flex-[1_1_auto] tw:items-center tw:gap-2 tw:min-w-0 tw:h-full tw:overflow-hidden tw:[&:not(.bms)]:shrink-0" @contextmenu.self.prevent="onBmMenu(undefined, $event)">
    <button
      v-for="b in bookmarks"
      :key="b.id"
      class="bm tw:group/bm tw:flex-none tw:inline-flex tw:items-center tw:gap-5 tw:max-w-180 tw:h-24 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:touch-none tw:hover:not-[&.dragging]:not-[&.open]:bg-hover tw:hover:not-[&.open]:text-text tw:[&.dragging]:not-[&.open]:bg-accent/18 tw:[&.open]:bg-accent/18 tw:[&.open]:text-text-hi tw:[&.dropin]:[outline:1px_solid_var(--accent)] tw:[&.nav]:not-[&.bmrow]:flex-none tw:[&.nav]:not-[&.key]:not-[&.rec]:not-[&.bmrow]:flex tw:[&.nav]:not-[&.bmrow]:items-center tw:[&.nav]:not-[&.bmrow]:gap-2 tw:[&.nav]:h-38 tw:[&.nav]:not-[&.key]:not-[&.body]:not-[&.bmrow]:py-0 tw:[&.nav]:not-[&.key]:not-[&.body]:not-[&.bmrow]:px-6 tw:[&.nav]:not-[&.key]:not-[&.bmrow]:border-b tw:[&.nav]:not-[&.key]:not-[&.bmrow]:border-b-border tw:[&.nav]:not-hover:not-[&.dragging]:not-[&.open]:not-[&.key]:not-[&.rec]:not-[&.body]:not-[&.bmrow]:bg-panel tw:[&.u-scheme]:not-hover:not-[&.open]:not-[&.u-host]:not-[&.u-path]:not-[&.u-sep]:not-[&.u-key]:not-[&.u-val]:not-[&.u-hash]:not-[&.key]:not-[&.bmrow]:text-muted tw:[&.u-host]:not-hover:not-[&.open]:not-[&.u-path]:not-[&.u-sep]:not-[&.u-key]:not-[&.u-val]:not-[&.u-hash]:not-[&.key]:not-[&.bmrow]:text-text-hi tw:[&.u-path]:not-hover:not-[&.open]:not-[&.u-sep]:not-[&.u-key]:not-[&.u-val]:not-[&.u-hash]:not-[&.key]:not-[&.bmrow]:text-text-2 tw:[&.u-sep]:not-hover:not-[&.open]:not-[&.u-key]:not-[&.u-val]:not-[&.u-hash]:not-[&.key]:not-[&.bmrow]:text-muted tw:[&.u-key]:not-hover:not-[&.open]:not-[&.u-val]:not-[&.u-hash]:not-[&.key]:not-[&.bmrow]:text-accent-fg tw:[&.u-val]:not-hover:not-[&.open]:not-[&.u-hash]:not-[&.key]:not-[&.bmrow]:text-accent tw:[&.u-hash]:not-hover:not-[&.open]:not-[&.key]:not-[&.bmrow]:text-info-fg tw:[&.key]:not-[&.rec]:absolute tw:[&.key]:right-52 tw:[&.key]:not-[&.rec]:not-[&.bmrow]:inline-flex tw:[&.key]:not-[&.body]:not-[&.bmrow]:p-5 tw:[&.key]:not-[&.rec]:not-[&.bmrow]:border-0 tw:[&.key]:not-hover:not-[&.dragging]:not-[&.open]:not-[&.rec]:not-[&.body]:not-[&.bmrow]:bg-transparent tw:[&.key]:not-hover:not-[&.open]:not-[&.bmrow]:text-warn tw:[&.rec]:relative tw:[&.rec]:not-[&.bmrow]:flex tw:[&.rec]:flex-col tw:[&.rec]:min-w-0 tw:[&.rec]:min-h-0 tw:[&.rec]:not-[&.bmrow]:border-l tw:[&.rec]:not-[&.bmrow]:border-l-border tw:[&.rec]:not-hover:not-[&.dragging]:not-[&.open]:not-[&.body]:not-[&.bmrow]:bg-panel tw:[&.body]:max-h-260 tw:[&.body]:overflow-auto tw:[&.body]:mt-8 tw:[&.body]:mr-0 tw:[&.body]:mb-0 tw:[&.body]:ml-0 tw:[&.body]:not-[&.bmrow]:p-8 tw:[&.body]:not-[&.bmrow]:rounded-r2 tw:[&.body]:not-hover:not-[&.dragging]:not-[&.open]:not-[&.bmrow]:bg-bg tw:[&.body]:font-data tw:[&.body]:not-[&.bmrow]:text-[11px] tw:[&.body]:whitespace-pre-wrap tw:[&.body]:break-all tw:[&.bmrow]:flex-none tw:[&.bmrow]:flex tw:[&.bmrow]:items-center tw:[&.bmrow]:gap-8 tw:[&.bmrow]:py-6 tw:[&.bmrow]:px-8 tw:[&.bmrow]:border-0 tw:[&.bmrow]:rounded-r2 tw:[&.bmrow]:not-hover:not-[&.dragging]:not-[&.open]:bg-transparent tw:[&.bmrow]:not-hover:not-[&.open]:text-text tw:[&.bmrow]:text-[12.5px] tw:[&.bmrow]:text-left tw:[&.bmrow]:touch-none tw:[&.bmrow]:hover:not-[&.dragging]:not-[&.dropin]:bg-hover tw:[&.bmrow]:[&.dragging]:not-[&.dropin]:bg-accent/18 tw:[&&&&]:[&.bmrow]:[&.dropin]:bg-accent/18 tw:[&&&]:hover:enabled:border-border-3"
      :class="[{ folder: !!b.children, dragging: bmDrag === b.id, open: folderPop?.id === b.id && !folderPop.trail.length }, dropCls(b.id)]"
      :data-bm="b.id"
      :title="b.url ?? b.title"
      @pointerdown="onBmDown($event, b)"
      @auxclick.prevent="$event.button === 1 && b.url && openUrl(b.url, true)"
      @contextmenu.prevent="onBmMenu(b, $event)"
    >
      <Icon v-if="b.children" name="folder" :size="12" class="bfi tw:text-warn tw:group-[.bmrow]/bm:text-warn" /><img v-else-if="b.icon && !badIcon.has(b.id)" class="bico tw:flex-none tw:w-14 tw:h-14 tw:group-[.bmrow]/bm:w-14 tw:group-[.bmrow]/bm:h-14" :src="b.icon" alt="" @error="badIcon.add(b.id)" /><Icon v-else name="globe" :size="12" class="bfi0 tw:text-muted tw:group-[.bmrow]/bm:text-muted" /><span class="tw:overflow-hidden tw:text-ellipsis tw:group-[.bmrow]/bm:flex-1 tw:group-[.bmrow]/bm:min-w-0 tw:group-[.bmrow]/bm:overflow-hidden tw:group-[.bmrow]/bm:text-ellipsis tw:group-[.bmrow]/bm:whitespace-nowrap">{{ b.title }}</span><Icon v-if="b.children" name="chevronDown" :size="10" />
    </button>
    <span v-if="!bookmarks.length" class="bhint tw:text-muted tw:text-[11.5px]" @contextmenu.prevent="onBmMenu(undefined, $event)">Закладки: ☆ в строке адреса или Ctrl+D · правый клик здесь — новая папка</span>
    <span class="grow tw:flex-1" @contextmenu.prevent="onBmMenu(undefined, $event)"></span>
    </span>
    <span v-if="pwAsk" class="pwask tw:[&:not(.bms)]:shrink-0 tw:inline-flex tw:items-center tw:gap-6 tw:mr-8 tw:pt-0 tw:pr-4 tw:pb-0 tw:pl-8 tw:h-26 tw:rounded-r2 tw:bg-warn/12 tw:text-warn-fg tw:text-[12px]">
      <Icon name="lock" :size="12" />{{ pwAsk.update ? 'Обновить пароль' : 'Сохранить пароль' }} для <b class="tw:text-text-hi">{{ hostOf(pwAsk.origin) }}</b><template v-if="pwAsk.username"> ({{ pwAsk.username }})</template>?
      <button class="primary tw:h-20 tw:py-0 tw:px-8 tw:text-[11.5px]" @click="pwReply('save')">{{ pwAsk.update ? 'Обновить' : 'Сохранить' }}</button>
      <button class="tw:h-20 tw:py-0 tw:px-8 tw:text-[11.5px]" @click="pwReply('no')">Не сейчас</button>
      <button class="tw:h-20 tw:py-0 tw:px-8 tw:text-[11.5px]" @click="pwReply('never')">Никогда для сайта</button>
    </span>
    <span v-if="download" class="dl tw:[&:not(.bms)]:shrink-0 tw:inline-flex tw:items-center tw:gap-6 tw:max-w-340 tw:pt-0 tw:pr-4 tw:pb-0 tw:pl-8 tw:h-24 tw:rounded-r2 tw:bg-up/10 tw:text-up-fg tw:text-[11.5px] tw:overflow-hidden tw:text-ellipsis" :title="download.path">
      <Icon name="download" :size="12" />{{ download.state === 'progress' ? 'Скачивается' : download.state === 'completed' ? 'Скачано' : 'Не скачано' }}: {{ download.name }}
      <button class="tw:py-1 tw:px-6 tw:text-[11px]" v-if="download.state === 'completed'" @click="reveal(download.path)">Показать</button>
      <button class="x tw:text-[11px] tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted" @click="download = undefined"><Icon name="x" :size="11" /></button>
    </span>
    <button class="ib pbtn tw:[&:not(.bms)]:shrink-0 tw:relative tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg tw:disabled:opacity-35 tw:hover:enabled:border-border-3" :class="{ on: recOpen }" :title="`Панель: проверка, запись запросов, Swagger, хуки${checkNew ? ` · найдено ${checkNew}` : ''}${recState.on ? ' · идёт запись запросов' : ''}`" @click="recOpen = !recOpen">
      <Icon name="list" :size="14" />
      <i v-if="recState.on" class="pdot tw:absolute tw:top-3 tw:right-3 tw:w-7 tw:h-7 tw:rounded-[50%] tw:bg-down tw:[.hsw_input:checked+&]:bg-accent tw:[.hsw_input:checked+&]:after:[transform:translateX(12px)] tw:[.hsw_input:checked+&]:after:bg-white"></i>
      <b v-if="checkNew" class="pcnt tw:absolute tw:-right-6 tw:-bottom-2 tw:min-w-16 tw:py-0 tw:px-4 tw:rounded-[8px] tw:bg-accent tw:text-white tw:text-[10px] tw:font-bold tw:leading-[15px] tw:text-center tw:[&.hot]:bg-down" :class="{ hot: checkHigh }">{{ checkNew > 99 ? '99+' : checkNew }}</b>
    </button>
    <button class="ib tw:[&:not(.bms)]:shrink-0 tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="История (Ctrl+H)" @click="openHistory"><Icon name="history" :size="15" /></button>
    <button class="ib tw:[&:not(.bms)]:shrink-0 tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Сохранённые пароли" @click="pwOpen = ''"><Icon name="lock" :size="14" /></button>
  </div>
</template>

<style scoped src="./BookmarkBar.css"></style>
