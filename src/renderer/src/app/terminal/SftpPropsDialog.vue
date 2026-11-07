<script setup lang="ts">
/**
 * An explorer entry's «Свойства»: name, path, type, size (a folder's — counted on request), rights, owner and group,
 * times (changed, created, metadata changed, last read), a link's target, inode and links, what its contents are.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { RemoteKind } from '@shared/ssh/remoteFiles'
import type { DirSummary, RemoteProps } from '@shared/ssh/remoteProps'
import { sizeText } from '@shared/ssh/transfers'
import { remoteError } from '@shared/remoteError'
import Icon from '../../components/Icon.vue'

const props = defineProps<{ sessionId: string; path: string }>()
const emit = defineEmits<{ close: [] }>()

const info = ref<RemoteProps>()
const error = ref('')
const count = ref<DirSummary>()
const counting = ref(false)
const countError = ref('')
watch(
  () => props.path,
  async (path) => {
    info.value = undefined
    error.value = ''
    count.value = undefined
    countError.value = ''
    try {
      const r = await window.qa.ssh('props', props.sessionId, path)
      if (path === props.path) info.value = r
    } catch (e) {
      if (path === props.path) error.value = remoteError(e)
    }
  },
  { immediate: true },
)
async function countDir(): Promise<void> {
  const path = props.path
  counting.value = true
  countError.value = ''
  try {
    const r = await window.qa.ssh('countDir', props.sessionId, path)
    if (path === props.path) count.value = r
  } catch (e) {
    if (path === props.path) countError.value = remoteError(e)
  } finally {
    counting.value = false
  }
}

const KIND_LABEL: Record<RemoteKind, string> = { dir: 'Папка', file: 'Файл', link: 'Символическая ссылка' }
const isDir = computed(() => info.value?.kind === 'dir' || (info.value?.kind === 'link' && info.value.targetKind === 'dir'))
const when = (ms?: number) => (ms ? new Date(ms).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'medium' }) : '')
const bytes = (n: number) => `${sizeText(n)} (${n.toLocaleString('ru-RU')} байт)`
/** The rights by who they are for: owner, group, others. */
const rightsBy = computed(() => {
  const r = info.value?.rights ?? ''
  const say = (s: string) => [s[0] === 'r' && 'чтение', s[1] === 'w' && 'запись', /[xst]/.test(s[2]) && 'выполнение'].filter(Boolean).join(', ') || 'нет'
  return [
    { who: 'Владелец', what: say(r.slice(0, 3)) },
    { who: 'Группа', what: say(r.slice(3, 6)) },
    { who: 'Остальные', what: say(r.slice(6, 9)) },
  ]
})
/** The rows shown: label → value (rows without a value left out). */
const rows = computed(() => {
  const i = info.value
  if (!i) return []
  const list: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: 'Путь', value: i.path, mono: true },
    { label: 'Тип', value: [KIND_LABEL[i.kind], i.typeText && i.typeText !== 'directory' && i.typeText !== 'regular file' ? `(${i.typeText})` : ''].filter(Boolean).join(' ') },
    { label: 'Ведёт на', value: i.target ? `${i.target}${i.targetKind ? ` — ${KIND_LABEL[i.targetKind].toLowerCase()}` : ' — не существует'}` : '', mono: true },
    { label: 'Содержимое', value: i.contents ?? '' },
    { label: 'Размер', value: isDir.value ? '' : bytes(i.size) },
    { label: 'Права', value: `${i.rights}  ·  ${i.octal}`, mono: true },
    { label: 'Владелец', value: i.owner ? `${i.owner} (uid ${i.uid})` : `uid ${i.uid}` },
    { label: 'Группа', value: i.group ? `${i.group} (gid ${i.gid})` : `gid ${i.gid}` },
    { label: 'Изменён', value: when(i.mtime) },
    { label: 'Создан', value: when(i.birth) || 'сервер не сообщает' },
    { label: 'Свойства изменены', value: when(i.ctime) },
    { label: 'Последнее открытие', value: when(i.atime) },
    { label: 'Inode', value: i.inode ?? '', mono: true },
    { label: 'Жёстких ссылок', value: i.links !== undefined ? String(i.links) : '' },
  ]
  return list.filter((r) => r.value)
})

const copyPath = () => void navigator.clipboard.writeText(props.path)

// Esc closes it (and goes no further)
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div class="tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:items-center tw:justify-center tw:bg-black/55" @mousedown.self="emit('close')">
      <section class="tw:flex tw:flex-col tw:gap-10 tw:w-[min(520px,calc(100vw-32px))] tw:max-h-[calc(100vh-48px)] tw:p-14 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:text-[12.5px]">
        <header class="tw:flex tw:flex-none tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
          <Icon :name="isDir ? 'folder' : 'file'" :size="16" class="tw:flex-none" :class="isDir ? 'tw:text-warn' : 'tw:text-muted'" />
          <b class="tw:min-w-0 tw:truncate tw:text-text-hi tw:text-[14px]" :title="info?.name ?? path">{{ info?.name ?? path }}</b>
          <span class="tw:flex-1"></span>
          <button class="tw:flex-none tw:inline-flex tw:p-5 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text" title="Копировать путь" @click="copyPath"><Icon name="copy" :size="13" /></button>
          <button class="tw:flex-none tw:inline-flex tw:p-5 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text" title="Закрыть (Esc)" @click="emit('close')"><Icon name="x" :size="14" /></button>
        </header>
        <p v-if="error" class="tw:m-0 tw:text-down-fg tw:wrap-anywhere">{{ error }}</p>
        <p v-else-if="!info" class="tw:m-0 tw:text-muted">Читаю свойства…</p>
        <div v-else class="tw:min-h-0 tw:overflow-y-auto tw:grid tw:grid-cols-[max-content_minmax(0,1fr)] tw:gap-x-14 tw:gap-y-6">
          <template v-for="r in rows" :key="r.label">
            <span class="tw:text-muted">{{ r.label }}</span>
            <span class="tw:text-text tw:wrap-anywhere tw:select-text" :class="{ 'tw:font-data tw:text-[12px]': r.mono }">{{ r.value }}</span>
          </template>
          <template v-if="isDir">
            <span class="tw:text-muted">Размер</span>
            <span class="tw:flex tw:flex-wrap tw:items-center tw:gap-8">
              <template v-if="count">{{ bytes(count.bytes) }} · файлов: {{ count.files.toLocaleString('ru-RU') }} · папок: {{ count.dirs.toLocaleString('ru-RU') }}</template>
              <button v-else class="tw:h-24 tw:py-0 tw:px-10 tw:rounded-full tw:text-[11.5px]" :disabled="counting" title="Сервер посчитает размер и число файлов внутри (du, find) — на большой папке это может занять время" @click="countDir">{{ counting ? 'Считаю…' : 'Посчитать' }}</button>
              <span v-if="countError" class="tw:text-down-fg">{{ countError }}</span>
            </span>
          </template>
          <span class="tw:text-muted">Доступ</span>
          <span class="tw:flex tw:flex-col tw:gap-2">
            <span v-for="r in rightsBy" :key="r.who"><span class="tw:text-text-2">{{ r.who }}:</span> {{ r.what }}</span>
          </span>
        </div>
      </section>
    </div>
  </Teleport>
</template>
