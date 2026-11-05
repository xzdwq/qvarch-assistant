<script setup lang="ts">
/**
 * Settings · the browser · moving in from another one: a profile's bookmarks (read from its folder, into a folder of
 * their own on the bar, the ones here already left out); its passwords from the CSV file it exports.
 */
import { ref } from 'vue'
import type { ImportSource } from '@shared/browser/browserImport'
import { remoteError } from '@shared/remoteError'

const sources = ref<ImportSource[]>([])
const pick = ref('')
const said = ref('')
const error = ref('')
const busy = ref(false)
async function load(): Promise<void> {
  sources.value = await window.qa.browser('importSources')
  if (!sources.value.some((s) => s.id === pick.value)) pick.value = sources.value[0]?.id ?? ''
}
void load()
/** One import run: its result said, its error shown. */
async function run(fn: () => Promise<string | undefined>): Promise<void> {
  busy.value = true
  said.value = ''
  error.value = ''
  try {
    said.value = (await fn()) ?? ''
  } catch (e) {
    error.value = remoteError(e)
  } finally {
    busy.value = false
  }
}
const importBookmarks = () =>
  run(async () => {
    const r = await window.qa.browser('importBookmarks', pick.value)
    return r.added ? `Закладок добавлено: ${r.added} — папка на панели закладок${r.skipped ? `; уже были: ${r.skipped}` : ''}` : `Новых закладок нет${r.skipped ? ` — все ${r.skipped} уже есть` : ''}`
  })
const importPasswords = () =>
  run(async () => {
    const r = await window.qa.browser('importPasswords')
    return r && `Паролей добавлено: ${r.added}, обновлено: ${r.updated}${r.skipped ? `; пропущено (не сайт или без пароля): ${r.skipped}` : ''}. Удалите файл паролей — в нём они не зашифрованы.`
  })
</script>

<template>
  <h3 class="tw:mt-26 tw:mb-8 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Импорт из другого браузера</h3>
  <div class="tw:flex tw:flex-wrap tw:items-end tw:gap-8">
    <label class="tw:flex tw:flex-col tw:gap-4 tw:min-w-0 tw:text-[12px] tw:text-muted">
      Профиль
      <select v-model="pick" :disabled="!sources.length || busy" @focus="load">
        <option v-if="!sources.length" value="">не найдено (Brave, Chrome, Edge, Vivaldi, Яндекс)</option>
        <option v-for="s in sources" :key="s.id" :value="s.id">{{ s.label }} — {{ s.bookmarks }} закл.</option>
      </select>
    </label>
    <button class="tw:h-28 tw:px-12" :disabled="!pick || busy" @click="importBookmarks">Импортировать закладки</button>
    <button class="tw:h-28 tw:px-12" :disabled="busy" title="Файл CSV, который браузер сохраняет при экспорте паролей" @click="importPasswords">Пароли из файла CSV…</button>
  </div>
  <p class="tw:mt-8 tw:mb-12 tw:text-muted tw:text-[12px]">
    Пароли другой браузер шифрует для себя — их переносят файлом: в Brave — brave://password-manager/settings → «Экспортировать пароли» (в Chrome и Edge — так же), потом «Пароли из файла CSV…». Пароль сайта с тем же логином заменяется новым.
  </p>
  <p v-if="said" class="tw:m-0 tw:mb-12 tw:text-up-fg tw:text-[12px]">{{ said }}</p>
  <p v-if="error" class="tw:m-0 tw:mb-12 tw:text-down-fg tw:text-[12px]">{{ error }}</p>
</template>
