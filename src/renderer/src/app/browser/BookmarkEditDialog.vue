<script setup lang="ts">
import { useBrowserView } from './browserViewContext'

/** A bookmark or a folder made / changed (teleported): its name, its address, the folder it is in. */
const { bmEdit, folders, saveBmEdit } = useBrowserView().bookmarks
</script>

<template>
  <div v-if="bmEdit" class="bq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[10vh] tw:bg-black/55" @mousedown.self="bmEdit = undefined">
    <form class="bq tw:flex tw:flex-col tw:gap-10 tw:w-[min(440px,calc(100vw-32px))] tw:max-h-[80vh] tw:overflow-auto tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)]" @submit.prevent="saveBmEdit" @keydown.esc="bmEdit = undefined">
      <div class="cap tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">{{ bmEdit.isFolder ? (bmEdit.id ? 'Папка' : 'Новая папка') : bmEdit.id ? 'Закладка' : 'Новая закладка — куда сохранить?' }}</div>
      <label class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Название<input v-model="bmEdit.title" spellcheck="false" /></label>
      <label v-if="!bmEdit.isFolder" class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Адрес<input v-model="bmEdit.url" spellcheck="false" /></label>
      <label class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">
        Где
        <select v-model="bmEdit.folder">
          <option value="">Панель закладок</option>
          <option v-for="f in folders.filter((x) => x.id !== bmEdit!.id)" :key="f.id" :value="f.id">{{ f.title }}</option>
        </select>
      </label>
      <div class="tqb tw:flex tw:gap-8"><button type="submit" class="primary">Сохранить</button><button type="button" @click="bmEdit = undefined">Отмена</button></div>
    </form>
  </div>
</template>
