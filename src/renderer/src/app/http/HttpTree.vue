<script setup lang="ts">
/** The collection's tree: requests in folders (drag to move, rename, copy, remove), its variables and common settings. */
import { ref } from 'vue'
import type { HttpFolder, HttpNode } from '@shared/http'
import { methodColor as mColor, methodShort as short } from '@shared/httpCollection'
import Icon from '../../components/Icon.vue'
import KvEditor from '../../components/KvEditor.vue'
import { vFocusSelect as vFocus } from '../../lib/focusSelect'
import { useHttpView } from './httpViewContext'

const { collection, side, helpOpen } = useHttpView()
const { doc, loaded, sel, rows, renaming, addRequest, addFolder, remove, duplicate, paste, onRowClick, dropNode } = collection
const { sideHidden, varsOpen, setOpen, dragSide } = side
/** «{{имя}}» as text (a mustache inside a mustache would close it). */
const VAR = '{{имя}}'
/** The variables ticked (filled ones): how many — what «Очистить» takes away at once. */
const checkedVars = () => doc.vars.filter((v) => v.on && (v.key || v.value))
function clearChecked(): void {
  const vars = doc.vars
  const n = checkedVars().length
  if (!n || !confirm(`Удалить отмеченные переменные (${n})? Секреты удалятся тоже.`)) return
  for (let i = vars.length - 1; i >= 0; i--) if (vars[i].on && (vars[i].key || vars[i].value)) vars.splice(i, 1)
}

// drag & drop: onto a folder — into it; onto a request — before it; onto the empty space — to the top level
const dragId = ref<string>()
const dropOn = ref<string>()
function onDrop(target?: HttpNode): void {
  const id = dragId.value
  dragId.value = undefined
  dropOn.value = undefined
  if (id) dropNode(id, target)
}
</script>

<template>
    <aside class="tree tw:relative tw:flex tw:flex-col tw:min-h-0 tw:border-r tw:border-r-border tw:bg-panel">
      <div class="tbar tw:flex tw:items-center tw:gap-2 tw:h-38 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-12 tw:border-b tw:border-b-border">
        <button class="shide tw:flex-none tw:rounded-r2 tw:mt-0 tw:mr-4 tw:mb-0 tw:-ml-6 tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-26 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-accent-fg tw:hover:bg-hover tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2" title="Скрыть панель" @click="sideHidden = true"><Icon name="sidebar" :size="14" /></button>
        <span class="cap">Запросы</span>
        <span class="grow tw:flex-1"></span>
        <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-26 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-accent-fg tw:hover:bg-hover tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2" title="Новый запрос" @click="addRequest"><Icon name="plus" :size="14" /></button>
        <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-26 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-accent-fg tw:hover:bg-hover tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2" title="Новая папка" @click="addFolder"><Icon name="folderPlus" :size="14" /></button>
        <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-26 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-accent-fg tw:hover:bg-hover tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2" title="Вставить скопированный запрос" @click="paste"><Icon name="clipboard" :size="14" /></button>
        <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-26 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:not-[&.on]:text-accent-fg tw:[&.on]:text-accent-fg tw:hover:not-[&.on]:bg-hover tw:[&.on]:bg-hover tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2" :class="{ on: varsOpen }" title="Переменные {{…}}" @click="(varsOpen = !varsOpen), (setOpen = false)"><b class="vb tw:font-data tw:text-[11px]">{x}</b></button>
        <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-26 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:not-[&.on]:text-accent-fg tw:[&.on]:text-accent-fg tw:hover:not-[&.on]:bg-hover tw:[&.on]:bg-hover tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2" :class="{ on: setOpen }" title="Для всех запросов: User-Agent, заголовки, время ожидания" @click="(setOpen = !setOpen), (varsOpen = false)"><Icon name="settings" :size="14" /></button>
      </div>
      <span class="sgrip tw:absolute tw:top-0 tw:-right-3 tw:bottom-0 tw:z-3 tw:w-6 tw:cursor-col-resize tw:hover:bg-accent-line" title="Ширина панели" @pointerdown="dragSide"></span>
      <div class="rows tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:py-4 tw:px-0" @dragover.prevent @drop.self="onDrop()">
        <div
          v-for="r in rows"
          :key="r.node.id"
          class="row tw:group/row tw:flex tw:items-center tw:gap-7 tw:h-30 tw:pr-6 tw:border-l-2 tw:border-l-transparent tw:whitespace-nowrap tw:text-[12.5px] tw:cursor-default tw:select-none tw:hover:not-[&.sel]:bg-hover tw:[&.sel]:border-l-accent tw:[&.sel]:bg-accent-soft tw:[&.drop]:[box-shadow:var(--shadow-ring-accent)] tw:[&.dragging]:opacity-40 tw:[&.folder]:font-semibold tw:[&.folder]:text-text-hi"
          :class="{ sel: sel === r.node.id, folder: r.node.type === 'folder', drop: dropOn === r.node.id, dragging: dragId === r.node.id }"
          :style="{ paddingLeft: `${8 + r.depth * 14}px` }"
          draggable="true"
          @dragstart="dragId = r.node.id"
          @dragend="(dragId = undefined), (dropOn = undefined)"
          @dragover.prevent="dropOn = r.node.id"
          @dragleave="dropOn === r.node.id && (dropOn = undefined)"
          @drop.stop="onDrop(r.node)"
          @click="onRowClick(r.node)"
          @dblclick.stop="renaming = r.node.id"
        >
          <template v-if="r.node.type === 'folder'">
            <Icon :name="(r.node as HttpFolder).open ? 'folderOpen' : 'folder'" :size="14" class="fi tw:[&&]:flex-none tw:text-warn" />
          </template>
          <b v-else class="mt tw:flex-none tw:w-34 tw:font-data tw:text-[9.5px] tw:font-bold" :style="{ color: mColor(r.node.method) }">{{ short(r.node.method) }}</b>
          <input v-if="renaming === r.node.id" v-model="r.node.name" class="ren tw:flex-1 tw:min-w-0 tw:h-22 tw:py-0 tw:px-6 tw:text-[12.5px]" spellcheck="false" @click.stop @keydown.enter="renaming = undefined" @keydown.esc="renaming = undefined" v-focus @blur="renaming = undefined" />
          <span v-else class="nm tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis">{{ r.node.name }}</span>
          <span class="acts tw:hidden tw:gap-1 tw:group-hover/row:inline-flex" @click.stop>
            <button class="tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2" title="Переименовать" @click="renaming = r.node.id"><Icon name="pencil" :size="12" /></button>
            <button class="tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2" title="Копия" @click="duplicate(r.node)"><Icon name="copy" :size="12" /></button>
            <button class="tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2" title="Удалить" @click="remove(r.node)"><Icon name="trash" :size="12" /></button>
          </span>
        </div>
        <p v-if="loaded && !rows.length" class="none tw:m-12 tw:text-muted tw:text-[12px]">Пусто — создайте запрос или папку</p>
      </div>
      <!-- the variables -->
      <div v-if="varsOpen" class="vars tw:max-h-[45%] tw:overflow-auto tw:p-8 tw:border-t tw:border-t-border">
        <div class="cap vh tw:flex tw:items-center tw:gap-4 tw:mb-6 tw:whitespace-nowrap"><span class="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis">Переменные · <span class="muted tw:normal-case tw:tracking-[0] tw:font-ui">{{ VAR }} в адресе, параметрах, заголовках, теле</span></span><button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-22 tw:ml-auto tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:text-down-fg tw:hover:enabled:bg-hover tw:disabled:opacity-35" :disabled="!checkedVars().length" :title="`Удалить отмеченные галочкой переменные (${checkedVars().length})`" @click="clearChecked"><Icon name="trash" :size="13" /></button></div>
        <KvEditor :rows="doc.vars" key-hint="имя" value-hint="значение" secrets />
        <p class="hint tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[12px]">🔒 — секрет: значение скрыто и хранится зашифрованным (токены, куки, пароли).</p>
      </div>
      <div v-if="setOpen && doc.settings" class="vars tw:max-h-[45%] tw:overflow-auto tw:p-8 tw:border-t tw:border-t-border">
        <div class="cap vh tw:mb-6">Для всех запросов</div>
        <label class="sl tw:flex tw:items-center tw:gap-8 tw:mb-6 tw:text-text-2 tw:text-[12px] tw:whitespace-nowrap">User-Agent <input class="tw:flex-1 tw:min-w-0 tw:h-26 tw:font-data tw:text-[12px]" v-model="doc.settings.userAgent" spellcheck="false" placeholder="Qvarch-HTTP/1.0" /></label>
        <label class="sl tw:flex tw:items-center tw:gap-8 tw:mb-6 tw:text-text-2 tw:text-[12px] tw:whitespace-nowrap">Ждать ответа, с <input class="tw:flex-1 tw:min-w-0 tw:h-26 tw:font-data tw:text-[12px]" v-model.number="doc.settings.timeoutSec" type="number" min="1" max="600" /></label>
        <div class="cap vh tw:mb-6">Общие заголовки</div>
        <KvEditor :rows="doc.settings.headers" key-hint="заголовок" />
        <p class="hint tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[12px]">Заголовок, заданный в самом запросе, важнее общего. Переменные {{ VAR }} работают и здесь.</p>
      </div>
      <button class="howto tw:[.seg_button+&]:not-hover:border-l tw:[.seg_button+&]:not-hover:border-l-border-2 tw:flex tw:items-center tw:gap-8 tw:m-8 tw:py-8 tw:px-10 tw:border tw:border-dashed tw:border-border-3 tw:rounded-r3 tw:bg-panel-2 tw:text-text-2 tw:text-[12px] tw:text-left tw:hover:border-accent tw:hover:text-accent-fg tw:hover:enabled:bg-hover" @click="helpOpen = true"><Icon name="book" :size="14" />Инструкция: скрипты и переменные</button>
    </aside>
</template>
