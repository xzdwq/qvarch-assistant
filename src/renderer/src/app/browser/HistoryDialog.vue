<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import { hostOf } from '../../lib/browser'
import { useBrowserView } from './browserViewContext'

/** The history (teleported): by days, searched, opened, forgotten; kept or not. */
const { bSettings, histOpen, visits, histQ, histLimit, histFound, histDays, histGo, histDel, histDelDay, histClear, setHistoryOn } = useBrowserView().history
const hhmm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div v-if="histOpen" class="bq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[10vh] tw:bg-black/55" @mousedown.self="histOpen = false">
    <div class="bq hist tw:flex tw:flex-col tw:max-h-[80vh] tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:w-[min(820px,calc(100vw-32px))] tw:h-[80vh] tw:p-0 tw:gap-0 tw:overflow-hidden" tabindex="-1" @keydown.esc="histOpen = false">
      <div class="hh tw:gap-12 tw:h-46 tw:pt-0 tw:pr-8 tw:pb-0 tw:pl-16 tw:whitespace-nowrap tw:flex tw:items-center tw:justify-between tw:border-b tw:border-b-border">
        <span class="cap tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">История</span>
        <label class="hsw tw:inline-flex tw:items-center tw:gap-8 tw:ml-6 tw:text-text-2 tw:text-[12.5px] tw:cursor-pointer" :title="bSettings.history ? 'Открытые страницы запоминаются' : 'Открытые страницы не запоминаются'"><input class="tw:hidden" type="checkbox" :checked="bSettings.history" @change="setHistoryOn(($event.target as HTMLInputElement).checked)" /><i class="tw:relative tw:w-28 tw:h-16 tw:rounded-[8px] tw:bg-panel-3 tw:[transition:background_0.15s] tw:[.hsw_input:checked+&]:bg-accent tw:after:content-[''] tw:after:absolute tw:after:top-2 tw:after:left-2 tw:after:w-12 tw:after:h-12 tw:after:rounded-[50%] tw:after:bg-text-2 tw:after:[transition:transform_0.15s] tw:[.hsw_input:checked+&]:after:[transform:translateX(12px)] tw:[.hsw_input:checked+&]:after:bg-white"></i>Сохранять историю</label>
        <span class="grow tw:flex-1"></span>
        <button class="hclr tw:inline-flex tw:items-center tw:gap-5 tw:h-28 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-40 tw:hover:enabled:border-border-3" :disabled="!visits.length" @click="histClear">Удалить<Icon name="chevronDown" :size="11" /></button>
        <button class="ib tw:flex-none tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:rounded-r2 tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:inline-flex tw:p-5 tw:border-0 tw:bg-transparent tw:text-muted" title="Закрыть (Esc)" @click="histOpen = false"><Icon name="x" :size="14" /></button>
      </div>
      <label class="hsearch tw:flex-none tw:flex tw:items-center tw:gap-8 tw:h-34 tw:mt-12 tw:mr-16 tw:mb-4 tw:ml-16 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-bg tw:text-muted tw:focus-within:border-accent/60"><Icon name="search" :size="13" /><input class="tw:flex-1 tw:min-w-0 tw:h-32 tw:p-0 tw:border-0 tw:bg-transparent tw:text-text tw:outline-none" :ref="(el) => el && histOpen && !histQ && (el as HTMLInputElement).focus()" v-model="histQ" placeholder="Поиск: название или адрес" spellcheck="false" /><span v-if="histQ" class="muted tw:text-muted tw:font-data tw:text-[11.5px]">{{ histFound.length }}</span></label>
      <p v-if="!bSettings.history" class="hoff tw:flex-none tw:mt-8 tw:mr-16 tw:mb-0 tw:ml-16 tw:py-8 tw:px-10 tw:rounded-r2 tw:bg-history-off/10 tw:text-text-2 tw:text-[12px]">История не сохраняется: новые страницы не запоминаются. Уже сохранённое осталось — его можно удалить.</p>
      <div class="hlist tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:pt-0 tw:pr-10 tw:pb-8 tw:pl-16">
        <template v-for="d in histDays" :key="d.k">
          <div class="hist-day tw:group/hday tw:sticky tw:top-0 tw:z-1 tw:flex tw:items-center tw:gap-8 tw:h-36 tw:pt-6 tw:pr-6 tw:pb-0 tw:pl-6 tw:bg-panel tw:text-text-hi tw:text-[12.5px] tw:font-semibold"><span class="hdt tw:first-letter:uppercase">{{ d.title }}</span><span class="muted tw:text-muted tw:font-data tw:text-[11px] tw:font-normal">{{ d.total }}</span><button class="hist-del tw:inline-flex tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:opacity-0 tw:ml-auto tw:hover:bg-white/8 tw:hover:text-text tw:hover:enabled:border-border-3" title="Удалить этот день из истории" @click="histDelDay(d.k, d.title)"><Icon name="trash" :size="12" /></button></div>
          <div v-for="v in d.items" :key="v.id" class="hist-row" :title="v.url" @click="histGo(v, $event)" @mousedown.middle.prevent @auxclick.prevent="$event.button === 1 && histGo(v, $event)">
            <span class="hist-time">{{ hhmm(v.at) }}</span>
            <span class="htt tw:overflow-hidden tw:text-text tw:text-[13px] tw:text-ellipsis tw:whitespace-nowrap">{{ v.title || v.url }}</span>
            <span class="hurl tw:max-w-240 tw:overflow-hidden tw:text-muted tw:text-[12px] tw:text-ellipsis tw:whitespace-nowrap">{{ hostOf(v.url) }}</span>
            <button class="hist-del tw:inline-flex tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:opacity-0 tw:hover:bg-white/8 tw:hover:text-text tw:hover:enabled:border-border-3" title="Удалить из истории" @click.stop="histDel([v.id])"><Icon name="x" :size="12" /></button>
          </div>
        </template>
        <button v-if="histFound.length > histLimit" class="hmore tw:block tw:my-10 tw:mx-auto tw:py-6 tw:px-14 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="histLimit += 500">Показать ещё ({{ histFound.length - histLimit }})</button>
        <p v-if="!visits.length" class="hint hempty tw:m-0 tw:text-muted tw:text-[11.5px]">{{ bSettings.history ? 'История пуста. Здесь появятся страницы, которые вы открываете, — по дням, со временем открытия.' : 'История пуста и не сохраняется.' }}</p>
        <p v-else-if="!histFound.length" class="hint hempty tw:m-0 tw:text-muted tw:text-[11.5px]">Ничего не нашлось</p>
      </div>
      <p class="hint hfoot tw:flex-none tw:pt-8 tw:pr-16 tw:pb-10 tw:pl-16 tw:border-t tw:border-t-border tw:m-0 tw:text-muted tw:text-[11.5px]">Клик — открыть, Ctrl+клик или средняя кнопка — в новой вкладке. Хранится 90 дней, только на этом компьютере.</p>
    </div>
  </div>
</template>
