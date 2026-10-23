<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import { hostOf } from '../../lib/browser'
import { useBrowserView } from './browserViewContext'
import { originOf } from './usePasswords'

/** The saved passwords (teleported): all, or a site's — shown, copied, filled into the page, deleted; the sites never offered. */
const view = useBrowserView()
const { byId, curId } = view.tabs
const { pwOpen, pwQ, pwShown, pwList, never, pwToggle, pwCopy, pwDel, pwFill, neverRemove } = view.passwords
</script>

<template>
  <div v-if="pwOpen !== undefined" class="bq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[10vh] tw:bg-black/55" @mousedown.self="pwOpen = undefined">
    <div class="bq wide tw:flex tw:flex-col tw:gap-10 tw:max-h-[80vh] tw:overflow-auto tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:w-[min(760px,calc(100vw-32px))]" tabindex="-1" @keydown.esc="pwOpen = undefined">
      <div class="cap tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Сохранённые пароли{{ pwOpen ? ` · ${hostOf(pwOpen)}` : '' }}</div>
      <p class="hint tw:m-0 tw:text-muted tw:text-[11.5px]">Хранятся на этом компьютере зашифрованными (Windows, только для вашей учётной записи). Сайт получает пароль, только когда открыт именно он.</p>
      <input v-if="!pwOpen" v-model="pwQ" placeholder="Поиск: сайт или логин" spellcheck="false" />
      <div class="pws tw:flex tw:flex-col tw:max-h-340 tw:overflow-auto tw:border tw:border-border tw:rounded-r2">
        <div v-for="x in pwList" :key="x.id" class="pw tw:flex-none tw:flex tw:items-center tw:gap-8 tw:min-h-34 tw:pt-0 tw:pr-8 tw:pb-0 tw:pl-10 tw:border-b tw:border-b-border tw:text-[12.5px] tw:last:border-b-0">
          <span class="pws-site tw:w-[30%] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-text-hi" :title="x.origin">{{ hostOf(x.origin) }}</span>
          <span class="pws-user tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ x.username || '(без логина)' }}</span>
          <code class="pws-pass tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:min-w-90">{{ pwShown[x.id] ?? '••••••••' }}</code>
          <button class="tw:inline-flex tw:items-center tw:py-3 tw:px-7 tw:text-[11.5px]" title="Показать / скрыть" @click="pwToggle(x.id)"><Icon :name="pwShown[x.id] !== undefined ? 'eyeOff' : 'eye'" :size="12" /></button>
          <button class="tw:inline-flex tw:items-center tw:py-3 tw:px-7 tw:text-[11.5px]" title="Копировать пароль" @click="pwCopy(x.id)"><Icon name="copy" :size="12" /></button>
          <button class="tw:inline-flex tw:items-center tw:py-3 tw:px-7 tw:text-[11.5px]" v-if="pwOpen && originOf(byId(curId)?.url) === x.origin" title="Подставить в форму входа на странице" @click="pwFill(x)">Подставить</button>
          <button class="tw:inline-flex tw:items-center tw:py-3 tw:px-7 tw:text-[11.5px]" title="Удалить" @click="pwDel(x)"><Icon name="trash" :size="12" /></button>
        </div>
        <p v-if="!pwList.length" class="hint tw:m-0 tw:text-muted tw:text-[11.5px]">Сохранённых паролей нет. Когда вы входите на сайт, Qvarch предложит сохранить пароль (полоса сверху).</p>
      </div>
      <template v-if="!pwOpen && never.length">
        <div class="cap tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Не предлагать для сайтов</div>
        <div class="pws tw:flex tw:flex-col tw:max-h-340 tw:overflow-auto tw:border tw:border-border tw:rounded-r2">
          <div v-for="o in never" :key="o" class="pw tw:flex-none tw:flex tw:items-center tw:gap-8 tw:min-h-34 tw:pt-0 tw:pr-8 tw:pb-0 tw:pl-10 tw:border-b tw:border-b-border tw:text-[12.5px] tw:last:border-b-0">
            <span class="pws-site tw:w-[30%] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-text-hi">{{ hostOf(o) }}</span>
            <span class="grow tw:flex-1"></span>
            <button class="tw:inline-flex tw:items-center tw:py-3 tw:px-7 tw:text-[11.5px]" @click="neverRemove(o)">Убрать из списка</button>
          </div>
        </div>
      </template>
      <div class="tqb tw:flex tw:gap-8"><button @click="pwOpen = undefined">Закрыть</button></div>
    </div>
  </div>
</template>
