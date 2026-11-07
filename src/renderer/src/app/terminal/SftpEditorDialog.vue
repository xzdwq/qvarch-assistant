<script setup lang="ts">
/** A server's text file in an editor: save to the server (Ctrl+S), save a copy to this PC, make a backup next to it. */
import CodeArea from '../../components/CodeArea.vue'
import Icon from '../../components/Icon.vue'
import { useTermView } from './termViewContext'

const { file, dirty, save, saveAs, backup, close } = useTermView().editor
function onKey(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void save()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}
</script>

<template>
  <div v-if="file" class="tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:items-center tw:justify-center tw:bg-black/55" @keydown="onKey">
    <section class="tw:flex tw:flex-col tw:gap-8 tw:w-[min(1100px,calc(100vw-32px))] tw:h-[min(820px,calc(100vh-48px))] tw:p-12 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)]">
      <header class="tw:flex tw:flex-none tw:items-center tw:gap-6 tw:min-w-0 tw:whitespace-nowrap">
        <Icon name="file" :size="14" class="tw:flex-none tw:text-muted" />
        <b class="tw:flex-none tw:text-text-hi tw:text-[13px]">{{ file.name }}</b>
        <span v-if="dirty" class="tw:flex-none tw:text-warn-fg" title="Есть несохранённые изменения">●</span>
        <span class="tw:min-w-0 tw:truncate tw:text-muted tw:font-data tw:text-[11.5px]" :title="file.path">{{ file.path }}</span>
        <span class="tw:flex-1"></span>
        <button class="primary tw:flex-none tw:inline-flex tw:items-center tw:gap-5 tw:h-26" :disabled="file.busy || !dirty" title="Сохранить на сервер (Ctrl+S)" @click="save()"><Icon name="check" :size="12" />Сохранить</button>
        <button class="tw:flex-none tw:inline-flex tw:items-center tw:gap-5 tw:h-26" title="Сохранить копию этого текста на этот ПК" @click="saveAs"><Icon name="download" :size="12" />Сохранить как…</button>
        <button class="tw:flex-none tw:inline-flex tw:items-center tw:gap-5 tw:h-26" :disabled="file.busy" title="Копия файла, как он сейчас на сервере, рядом с ним: имя.backup-дата_время" @click="backup"><Icon name="copy" :size="12" />Резервная копия</button>
        <button class="tw:flex-none tw:inline-flex tw:p-5 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text" title="Закрыть (Esc)" @click="close"><Icon name="x" :size="14" /></button>
      </header>
      <div class="tw:flex-1 tw:min-h-0 tw:flex tw:flex-col tw:border tw:border-border tw:rounded-r2 tw:overflow-hidden">
        <CodeArea v-model="file.text" :lang="file.lang" fill :min-height="200" :run="() => save()" />
      </div>
      <footer v-if="file.error || file.note" class="tw:flex tw:flex-none tw:items-center tw:gap-8 tw:min-w-0 tw:text-[12px]">
        <span v-if="file.error" class="tw:min-w-0 tw:truncate tw:text-down-fg" :title="file.error">{{ file.error }}</span>
        <button v-if="file.conflict" class="tw:flex-none tw:h-24" :disabled="file.busy" @click="save(true)">Перезаписать</button>
        <span v-else-if="file.note" class="tw:min-w-0 tw:truncate tw:text-up-fg" :title="file.note">{{ file.note }}</span>
      </footer>
    </section>
  </div>
</template>
