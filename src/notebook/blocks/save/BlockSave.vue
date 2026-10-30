<script setup lang="ts">
/**
 * «Сохранить в файл» (```save): a variable of the note written as a new file each run — when it changed. Its settings
 * (the variable, the format, the folder, how many files to keep, what to do with a partial value) and its last file
 * (opened, shown in its folder).
 */
import { computed, ref } from 'vue'
import { SAVE_FORMATS, type PartialMode, type SaveFormat } from '@shared/valueFiles'
import { remoteError } from '@shared/remoteError'
import { noteRun } from '@nb/engine'
import Icon from '@renderer/components/Icon.vue'
import SuggestInput from '@renderer/components/SuggestInput.vue'
import RunHead from '../../ui/RunHead.vue'
import { useBlockRun } from '../../ui/useBlockRun'
import { useFenceSource } from '../../ui/useFenceSource'
import { saveOf, withSave, type SaveKey } from './model'

const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const fence = useFenceSource(props)
const { body } = fence
const { run, start, stop, report } = useBlockRun(props, 'save', fence)
const s = computed(() => saveOf(body.value))
const set = (key: SaveKey, value: string) => (body.value = withSave(body.value, key, value))
async function go(): Promise<void> {
  fence.flush()
  await start()
}

/** The note's variables (the ones to pick from). */
const names = computed(() => Object.keys(noteRun(props.path).ctx).sort())
const FORMAT_LABEL: Record<SaveFormat, string> = { auto: 'авто', xlsx: 'Excel', csv: 'CSV', json: 'JSON', txt: 'текст' }
const FORMAT_HINT: Record<SaveFormat, string> = {
  auto: 'По данным: список записей — Excel, текст — .txt, остальное — JSON',
  xlsx: 'Excel: строки и столбцы (вложенное — JSON в ячейке)',
  csv: 'CSV: строки и столбцы',
  json: 'JSON как есть',
  txt: 'Текст (не текст — JSON)',
}
const PARTIAL_LABEL: Record<PartialMode, string> = { mark: 'с пометкой', skip: 'не сохранять' }

const defaultDir = ref('')
void window.qa.valueFile('defaultDir').then((d) => (defaultDir.value = d))
const said = ref('')
const act = (fn: () => Promise<unknown>) => {
  said.value = ''
  return fn().catch((e) => (said.value = remoteError(e)))
}
const openFolder = () => act(() => window.qa.valueFile('reveal', s.value.dir || defaultDir.value))
const openFile = (f: string) => act(() => window.qa.valueFile('open', f))
const revealFile = (f: string) => act(() => window.qa.valueFile('reveal', f))
async function pickDir(): Promise<void> {
  const d = await window.qa.valueFile('pickDir')
  if (d) set('dir', d)
}
const saved = computed(() => run.value?.saved)
const fileName = computed(() => saved.value?.file?.split(/[\\/]/).pop() ?? '')
const when = computed(() => (run.value?.at ? new Date(run.value.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''))
const seg = 'tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg'
const iconBtn = 'tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text'
const field = 'tw:inline-flex tw:items-center tw:gap-4 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap'
</script>

<template>
  <div class="tw:contain-[inline-size] tw:min-w-0 tw:flex tw:flex-col tw:gap-6 tw:py-8 tw:px-10 tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-(--block-ref) tw:rounded-[8px] tw:bg-panel">
    <RunHead :report="report" icon="download" kind="Сохранить в файл" :run="run" can-run :named="false" @run="go" @stop="stop" />
    <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-8">
      <label :class="field" title="Переменная заметки (можно путь: login.body.items)">
        {{ '{' }}{{ '{' }}<SuggestInput class="tw:w-150 tw:h-22 tw:py-0 tw:px-6" :model-value="s.ref" :options="names" placeholder="переменная" @update:model-value="(v: string) => set('ref', v)" />{{ '}' }}{{ '}' }}
      </label>
      <span class="tw:inline-flex tw:flex-none tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden">
        <button v-for="f in SAVE_FORMATS" :key="f" :class="[seg, { on: s.format === f }]" :title="FORMAT_HINT[f]" @mousedown.prevent @click="set('format', f)">{{ FORMAT_LABEL[f] }}</button>
      </span>
      <label :class="[field, 'tw:flex-1 tw:min-w-200']" title="Папка для файлов (полный путь). Пусто — папка по умолчанию">
        <Icon name="folder" :size="12" />
        <input class="tw:flex-1 tw:min-w-0 tw:h-22 tw:py-0 tw:px-6" :value="s.dir" :placeholder="defaultDir" spellcheck="false" @change="set('dir', ($event.target as HTMLInputElement).value)" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" />
        <button :class="iconBtn" title="Выбрать папку" @click="pickDir"><Icon name="more" :size="12" /></button>
        <button :class="iconBtn" title="Открыть папку" @click="openFolder"><Icon name="external" :size="12" /></button>
      </label>
      <label :class="field" title="Хранить только последние N файлов этой переменной (старые удаляются). Пусто — хранить все">
        хранить
        <input class="tw:w-56 tw:h-22 tw:py-0 tw:px-4" type="number" min="1" :value="s.files ?? ''" placeholder="все" @change="set('files', ($event.target as HTMLInputElement).value)" />
      </label>
      <label :class="field" title="Если прогон остановлен или упал и данные накоплены не полностью">
        неполные
        <span class="tw:inline-flex tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden">
          <button v-for="(label, m) in PARTIAL_LABEL" :key="m" :class="[seg, { on: s.partial === m }]" @mousedown.prevent @click="set('partial', m)">{{ label }}</button>
        </span>
      </label>
    </div>
    <div class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:text-[11.5px] tw:whitespace-nowrap">
      <template v-if="run?.state === 'error'"><span class="tw:min-w-0 tw:truncate tw:text-down-fg" :title="run.error">{{ run.error }}</span></template>
      <template v-else-if="saved?.skipped || saved?.unchanged">
        <span class="tw:text-muted">{{ when }} · {{ saved.skipped ?? 'без изменений — файл не записан' }}</span>
      </template>
      <span v-else-if="run?.state === 'ok' && saved?.file" class="tw:text-up-fg">{{ when }} · сохранено{{ saved.removed ? ` · удалено старых: ${saved.removed}` : '' }}</span>
      <span v-else-if="!run" class="tw:text-muted">Каждый прогон — новый файл «документ - переменная - дата время», если данные изменились</span>
      <template v-if="saved?.file">
        <span class="tw:flex-1"></span>
        <button class="tw:min-w-0 tw:truncate tw:p-0 tw:border-0 tw:bg-transparent tw:text-accent-fg tw:hover:underline" :title="`Открыть ${saved.file}`" @click="openFile(saved!.file!)">{{ fileName }}</button>
        <button :class="iconBtn" title="Показать в папке" @click="revealFile(saved!.file!)"><Icon name="folder" :size="12" /></button>
      </template>
    </div>
    <p v-if="said" class="tw:m-0 tw:text-down-fg tw:text-[11.5px]">{{ said }}</p>
  </div>
</template>
