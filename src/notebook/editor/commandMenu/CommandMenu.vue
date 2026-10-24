<script setup lang="ts">
import { durText, periodText, statusOf, statusText } from '@shared/noteEvents'
import { events, kindOf } from '@renderer/lib/noteEvents'
import Icon from '@renderer/components/Icon.vue'
import { chipClock, issueStatusClass, shortDate } from '../eventChips'
import type { CommandMenuState, MenuRow } from './useCommandMenu'

/**
 * The «@» menu drawn by the cursor's «@» (over everything): the general list (commands, emoji, boards, events, Jira
 * tasks) or a sub-menu of its own — the emoji grid, a table's size. Its state and keys — useCommandMenu.
 */
const props = defineProps<{ menu: CommandMenuState }>()
const rowIndex = (r: MenuRow) => props.menu.pickable.indexOf(r)
const kindIcon = (k: string) => kindOf(k)?.icon ?? 'tag'
const kindColor = (k: string) => kindOf(k)?.color ?? 'var(--muted)'
const kindLabel = (k: string) => kindOf(k)?.label ?? k
const boardName = (p: string) => (p.split('/').pop() ?? p).replace(/\.qboard$/i, '')
const boardDir = (p: string) => p.split('/').slice(0, -1).join(' / ')
const setList = (el: unknown) => (props.menu.listEl = (el as HTMLElement | null) ?? undefined)
</script>

<template>
  <Teleport to="body">
    <div v-if="menu.place && menu.mode?.mode === 'emoji'" :ref="setList" class="mde-pick" :style="{ left: `${menu.place.x}px`, [menu.place.up ? 'bottom' : 'top']: `${menu.place.y}px` }" @mousedown.prevent>
      <div class="pk-h">Эмодзи<span class="pk-more">{{ menu.mode.q ? `по запросу «${menu.mode.q}»` : 'пишите название — по-русски или по-английски' }}</span></div>
      <div class="em-grid">
        <button v-for="(e, i) in menu.emojiShown" :key="e.u" class="em" :class="{ on: i === menu.emojiIdx }" :title="`${e.ru} · ${e.en}`" @mouseenter="menu.emojiIdx = i" @click="menu.pickEmoji(e)">{{ e.u }}</button>
      </div>
      <p v-if="!menu.emojiShown.length" class="pk-empty">{{ menu.emojiAll.length ? 'Такого эмодзи нет' : 'Загружаю эмодзи…' }}</p>
      <div class="pk-f">{{ menu.emojiShown[menu.emojiIdx] ? `${menu.emojiShown[menu.emojiIdx].u}  ${menu.emojiShown[menu.emojiIdx].ru} · ${menu.emojiShown[menu.emojiIdx].en}` : 'Стрелки — выбрать · Enter — вставить · Esc — закрыть' }}</div>
    </div>
    <div v-else-if="menu.place && menu.mode?.mode === 'table'" :ref="setList" class="mde-pick narrow" :style="{ left: `${menu.place.x}px`, [menu.place.up ? 'bottom' : 'top']: `${menu.place.y}px` }" @mousedown.prevent>
      <div class="pk-h">Таблица<span class="pk-more">наведите или стрелки, Enter — вставить</span></div>
      <div class="ts-grid">
        <template v-for="r in 12" :key="r">
          <span v-for="c in 10" :key="c" class="ts" :class="{ on: c <= menu.size.c && r <= menu.size.r }" @mouseenter="menu.size = { c, r: Math.max(2, r) }" @click="menu.pickTable"></span>
        </template>
      </div>
      <div class="ts-n">{{ menu.size.c }} × {{ menu.size.r }}</div>
    </div>
    <div v-else-if="menu.place" :ref="setList" class="mde-pick" :class="{ up: menu.place.up }" :style="{ left: `${menu.place.x}px`, [menu.place.up ? 'bottom' : 'top']: `${menu.place.y}px` }" @mousedown.prevent>
      <template v-for="(r, i) in menu.rows" :key="i">
        <div v-if="'head' in r" class="pk-h">{{ r.head }}<span v-if="r.more" class="pk-more">ещё {{ r.more }} — уточните поиск</span></div>
        <button v-else-if="'cmd' in r" class="pk cmd" :class="{ on: rowIndex(r) === menu.pickIdx }" @mouseenter="menu.pickIdx = rowIndex(r)" @click="menu.pickAt(rowIndex(r))">
          <span class="pk-ic cmd"><Icon :name="r.cmd.icon" :size="14" /></span>
          <span class="pk-b">
            <span class="pk-t">{{ r.cmd.title }}</span>
            <span class="pk-m">{{ r.cmd.hint }}</span>
          </span>
          <span></span>
        </button>
        <div v-else-if="'emojis' in r" class="pk strip" :class="{ on: rowIndex(r) === menu.pickIdx }" @mouseenter="menu.pickIdx = rowIndex(r)">
          <button v-for="(e, ei) in r.emojis" :key="e.u" class="em" :class="{ on: rowIndex(r) === menu.pickIdx && ei === menu.stripIdx }" :title="`${e.ru} · ${e.en}`" @mouseenter="menu.stripIdx = ei" @click="menu.pickEmoji(e)">{{ e.u }}</button>
        </div>
        <button v-else-if="'board' in r" class="pk" :class="{ on: rowIndex(r) === menu.pickIdx }" @mouseenter="menu.pickIdx = rowIndex(r)" @click="menu.pickAt(rowIndex(r))">
          <span class="pk-ic cmd"><Icon name="presentation" :size="14" /></span>
          <span class="pk-b">
            <span class="pk-t">{{ boardName(r.board) }}</span>
            <span class="pk-m">Доска{{ boardDir(r.board) ? ` · ${boardDir(r.board)}` : '' }} — встанет в заметку, рисовать можно прямо здесь</span>
          </span>
          <span></span>
        </button>
        <button v-else-if="'newBoard' in r" class="pk" :class="{ on: rowIndex(r) === menu.pickIdx }" @mouseenter="menu.pickIdx = rowIndex(r)" @click="menu.pickAt(rowIndex(r))">
          <span class="pk-ic cmd"><Icon name="plus" :size="14" /></span>
          <span class="pk-b">
            <span class="pk-t">{{ r.newBoard ? `Новая доска «${r.newBoard}»` : 'Новая доска' }}</span>
            <span class="pk-m">Создаётся рядом с заметкой и встаёт сюда; название — словами после «@доска»</span>
          </span>
          <span></span>
        </button>
        <button v-else-if="'ev' in r" class="pk" :class="{ on: rowIndex(r) === menu.pickIdx }" @mouseenter="menu.pickIdx = rowIndex(r)" @click="menu.pickAt(rowIndex(r))">
          <span class="pk-ic" :style="{ color: kindColor(r.ev.kind), background: `color-mix(in srgb, ${kindColor(r.ev.kind)} 16%, transparent)` }"><Icon :name="kindIcon(r.ev.kind)" :size="14" /></span>
          <span class="pk-b">
            <span class="pk-t">{{ r.ev.label || 'Без названия' }}</span>
            <span class="pk-m">{{ kindLabel(r.ev.kind) }}<template v-if="r.ev.outlook"> · Outlook</template> · {{ periodText(r.ev, chipClock) }} · {{ durText(r.ev.end - r.ev.start) }}<template v-if="r.ev.created"> · созд. {{ shortDate(r.ev.created) }}</template></span>
          </span>
          <span class="pk-st" :class="statusOf(r.ev, chipClock)">{{ statusText(r.ev, chipClock) }}</span>
        </button>
        <button v-else class="pk" :class="{ on: rowIndex(r) === menu.pickIdx }" @mouseenter="menu.pickIdx = rowIndex(r)" @click="menu.pickAt(rowIndex(r))">
          <span class="pk-ic" style="color: var(--editor-jira-chip); background: color-mix(in srgb, var(--editor-jira-chip) 16%, transparent)"><Icon name="jira" :size="14" /></span>
          <span class="pk-b">
            <span class="pk-t">{{ r.jira.key }} {{ r.jira.summary }}</span>
            <span class="pk-m">{{ r.jira.type }} · {{ r.jira.project.name }}</span>
          </span>
          <span class="pk-st" :class="issueStatusClass(r.jira.category)">{{ r.jira.status }}</span>
        </button>
      </template>
      <p v-if="!menu.rows.length" class="pk-empty">{{ events.length ? 'Ничего не нашлось' : 'Загружаю события…' }}</p>
      <div class="pk-f">↑↓ — выбрать · Enter — вставить · Esc — закрыть · пишите дальше — поиск</div>
    </div>
  </Teleport>
</template>

<style src="./CommandMenu.global.css"></style>
