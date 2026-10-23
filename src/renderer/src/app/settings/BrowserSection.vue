<script setup lang="ts">
/** Settings · the built-in browser: history, untrusted certificates, sleeping tabs, the User-Agent; applied at once. */
import { computed, ref } from 'vue'
import { DEFAULT_BROWSER_SETTINGS, UA_PRESETS, type BrowserSettings } from '@shared/browser'
import { onBrowserEvent } from '../../lib/browser'

const brSet = ref<BrowserSettings>({ ...DEFAULT_BROWSER_SETTINGS })
const uaDefault = ref('')
/** The User-Agent being typed (one's own). */
const uaOwn = ref<string>()
void window.qa.browser('settings').then((v) => (brSet.value = v))
void window.qa.browser('defaultUa').then((v) => (uaDefault.value = v))
onBrowserEvent((type, p) => type === 'settings' && (brSet.value = p as BrowserSettings))
async function brPatch(patch: Partial<BrowserSettings>): Promise<void> {
  brSet.value = await window.qa.browser('setSettings', patch)
}
/** The select's choice of one's own User-Agent (the presets are chosen by their index). */
const OWN_UA = 'own'
const uaPick = computed(() => {
  if (uaOwn.value !== undefined) return OWN_UA
  const i = UA_PRESETS.findIndex((p) => p.ua === brSet.value.ua)
  return i < 0 ? OWN_UA : String(i)
})
const ownUaPicked = computed(() => uaPick.value === OWN_UA)
const uaShown = computed(() => uaOwn.value ?? (brSet.value.ua || uaDefault.value))
function onUaPick(v: string): void {
  if (v === OWN_UA) {
    uaOwn.value = brSet.value.ua || uaDefault.value
    return
  }
  uaOwn.value = undefined
  void brPatch({ ua: UA_PRESETS[Number(v)]?.ua ?? '' })
}
function applyUa(): void {
  const v = (uaOwn.value ?? '').replace(/\s+/g, ' ').trim()
  // the built-in one typed back — it is the built-in one
  void brPatch({ ua: v === uaDefault.value ? '' : v })
  if (!v) uaOwn.value = undefined
}
</script>

<template>
    <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
      <h3 class="tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Браузер</h3>
      <div class="olopts tw:flex tw:flex-col tw:max-w-420 tw:mt-10">
        <label class="switch tw:flex-row tw:items-center tw:justify-between tw:gap-10 tw:py-5 tw:px-0 tw:text-text tw:text-[13px] tw:cursor-pointer tw:flex"><input class="tw:appearance-none tw:flex-none tw:relative tw:w-32 tw:h-18 tw:m-0 tw:rounded-[4px] tw:bg-white/14 tw:cursor-pointer tw:[transition:background_0.2s] tw:checked:bg-accent tw:[.secret_&]:flex-1 tw:after:content-[''] tw:after:absolute tw:after:top-2 tw:after:left-2 tw:after:w-14 tw:after:h-14 tw:after:rounded-[50%] tw:after:bg-text-hi tw:after:[transition:transform_0.2s_cubic-bezier(0.32,0.72,0,1)] tw:checked:after:[transform:translateX(14px)]" type="checkbox" :checked="brSet.history" @change="brPatch({ history: ($event.target as HTMLInputElement).checked })" /><span class="tw:-order-1">Сохранять историю посещений</span></label>
      </div>
      <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Открытые страницы запоминаются по дням, со временем открытия: 90 дней, только на этом компьютере. По ним же — подсказки в строке адреса. Сама история — в разделе «Браузер»: кнопка с часами или Ctrl+H. Выключение не удаляет уже сохранённое.</p>
      <div class="olopts tw:flex tw:flex-col tw:max-w-420 tw:mt-10">
        <label class="switch tw:flex-row tw:items-center tw:justify-between tw:gap-10 tw:py-5 tw:px-0 tw:text-text tw:text-[13px] tw:cursor-pointer tw:flex"><input class="tw:appearance-none tw:flex-none tw:relative tw:w-32 tw:h-18 tw:m-0 tw:rounded-[4px] tw:bg-white/14 tw:cursor-pointer tw:[transition:background_0.2s] tw:checked:bg-accent tw:[.secret_&]:flex-1 tw:after:content-[''] tw:after:absolute tw:after:top-2 tw:after:left-2 tw:after:w-14 tw:after:h-14 tw:after:rounded-[50%] tw:after:bg-text-hi tw:after:[transition:transform_0.2s_cubic-bezier(0.32,0.72,0,1)] tw:checked:after:[transform:translateX(14px)]" type="checkbox" :checked="brSet.acceptBadCerts" @change="brPatch({ acceptBadCerts: ($event.target as HTMLInputElement).checked })" /><span class="tw:-order-1">Открывать сайты с недоверенным сертификатом</span></label>
      </div>
      <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Свой (самоподписанный), просроченный или выданный на другое имя — как у внутренних сайтов. Такой сайт открывается сразу, замок перед адресом становится красным: защищённость соединения тогда не гарантируется. Выключено — Qvarch спросит; а не загрузившаяся часть страницы (счётчик, реклама) больше не заменяет страницу ошибкой.</p>
      <div class="fields tw:grid tw:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] tw:gap-12">
        <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">
          Неактивная вкладка засыпает через
          <select :value="brSet.sleepMin" @change="brPatch({ sleepMin: Number(($event.target as HTMLSelectElement).value) })">
            <option :value="0">никогда</option>
            <option v-for="m in [5, 15, 30, 60]" :key="m" :value="m">{{ m }} мин</option>
          </select>
        </label>
      </div>
      <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Каждая вкладка браузера — отдельный процесс (сотни МБ памяти). Уснувшая вкладка остаётся в списке и загружается заново, когда вы её открываете. Не засыпают: показанные, с открытыми инструментами разработчика, в режиме устройства, со звуком и во время записи запросов.</p>
      <h3 class="mt tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2 tw:[&&]:mt-26">User-Agent</h3>
      <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Как браузер представляется сайтам. Действует сразу на все вкладки; уже открытые страницы увидят его после обновления (F5). У вкладки в режиме устройства — User-Agent этого устройства.</p>
      <div class="fields tw:grid tw:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] tw:gap-12">
        <label class="span2 tw:col-span-full tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">
          Вариант
          <select :value="uaPick" @change="onUaPick(($event.target as HTMLSelectElement).value)">
            <option v-for="(p, i) in UA_PRESETS" :key="i" :value="String(i)">{{ p.label }}</option>
            <option :value="OWN_UA">Свой…</option>
          </select>
        </label>
        <label class="span2 tw:col-span-full tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">
          Строка User-Agent
          <textarea
            class="uabox tw:[.prompt_&]:w-full tw:[.prompt_&]:box-border tw:[.prompt_&]:resize-y tw:[.prompt_&]:py-8 tw:[.prompt_&]:px-10 tw:[.prompt_&]:rounded-[4px] tw:[.prompt_&]:border tw:[.prompt_&]:border-border tw:[.prompt_&]:bg-field tw:[.prompt_&]:not-[&[readonly]]:text-text tw:[.prompt_&]:[font-style:inherit] tw:[.prompt_&]:[font-variant:inherit] tw:[.prompt_&]:[font-weight:inherit] tw:[.prompt_&]:[font-stretch:inherit] tw:[.prompt_&]:[font-family:inherit] tw:[&&]:[.prompt_&]:text-[12px] tw:[&&]:[.prompt_&]:leading-[1.45] tw:w-full tw:min-h-64 tw:resize-y tw:font-data tw:text-[12px] tw:leading-[1.5] tw:[&[readonly]]:text-text-2"
            :value="uaShown"
            rows="3"
            spellcheck="false"
            :readonly="!ownUaPicked"
            placeholder="Mozilla/5.0 …"
            @input="uaOwn = ($event.target as HTMLTextAreaElement).value"
            @change="applyUa"
            @keydown.enter.prevent="($event.target as HTMLTextAreaElement).blur()"
          ></textarea>
        </label>
      </div>
      <p v-if="ownUaPicked" class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Впишите строку и нажмите Enter (или щёлкните мимо). Пустая строка — встроенный User-Agent.</p>
    </section>
</template>
