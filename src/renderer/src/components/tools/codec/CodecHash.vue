<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { remoteError } from '../../../../../shared/remoteError'
import { HASH_ALGS, sniffEncoded, type HashAlg } from '@shared/codec'
import Icon from '../../Icon.vue'
import { expectedHex, fmtSize, hashHex, normHash, showDigest } from '@shared/codecText'
import type { CopyNote } from './useCopyNote'

/**
 * Хэш: MD5 / SHA of a text or a file (HMAC with a key), checked against an expected one; a pasted string is
 * recognised (a hash by its length, Base64, JWT…) and a guess of a hash's source text checked.
 */
const props = defineProps<{ clip: CopyNote }>()
/** How long the input rests before it is hashed / a guess checked (ms). */
const HASH_DELAY_MS = 150
const GUESS_DELAY_MS = 200
const hText = ref('')
/** A file hashed instead of the text (read by the app from the disk — any size). */
const hFile = shallowRef<{ name: string; size: number; path?: string; bytes?: Uint8Array }>()
const hKey = ref('')
const hExpect = ref('')
const hUpper = ref(false)
const hB64 = ref(false)
const hashes = ref<Partial<Record<HashAlg, string>>>({})
const hBusy = ref(false)
const hError = ref('')
let hTimer: ReturnType<typeof setTimeout> | undefined
let hSeq = 0
watch([hText, hFile, hKey], () => {
  clearTimeout(hTimer)
  hTimer = setTimeout(async () => {
    const my = ++hSeq
    if (!hFile.value && !hText.value) return void (hashes.value = {})
    hBusy.value = true
    hError.value = ''
    try {
      const f = hFile.value
      const r = await window.qa.hashOf(f ? (f.path ? { path: f.path } : { bytes: f.bytes }) : { text: hText.value }, hKey.value || undefined)
      if (my === hSeq) hashes.value = r
    } catch (e) {
      if (my === hSeq) hError.value = remoteError(e)
    } finally {
      if (my === hSeq) hBusy.value = false
    }
  }, HASH_DELAY_MS)
})
/** An algorithm's digest as shown (hex / upper case / Base64). */
const shown = (alg: HashAlg) => {
  const h = hashes.value[alg]
  return h ? showDigest(h, hB64.value, hUpper.value) : ''
}
/** The expected hash (hex any case, or Base64) — which algorithm gives it. */
const expectHex = computed(() => expectedHex(hExpect.value))
const matchAlg = computed(() => (expectHex.value ? HASH_ALGS.find((a) => hashes.value[a.id] === expectHex.value)?.id : undefined))
/** What the pasted text already is (a hash, Base64, JWT…) — when it is not a file. */
const sniffed = computed(() => (hFile.value ? [] : sniffEncoded(hText.value)))
/** A guess of the original text, for a pasted hash: does it hash into it? */
const guess = ref('')
const guessHit = ref<HashAlg | null>()
let gTimer: ReturnType<typeof setTimeout> | undefined
watch([guess, hText, hKey], () => {
  clearTimeout(gTimer)
  guessHit.value = undefined
  const target = normHash(hText.value)
  if (!guess.value || !sniffed.value.some((x) => x.kind === 'hash')) return
  gTimer = setTimeout(async () => {
    const r = await window.qa.hashOf({ text: guess.value }, hKey.value || undefined)
    const hex = hashHex(target)
    guessHit.value = HASH_ALGS.find((a) => r[a.id] === hex)?.id ?? null
  }, GUESS_DELAY_MS)
})
const hFileIn = ref<HTMLInputElement>()
const hDragging = ref(false)
/** A file to hash: by its path (read by the app), else its bytes. */
function takeHashFile(file: File | undefined): void {
  hDragging.value = false
  if (!file) return
  const path = window.qa.pathForFile(file)
  if (path) hFile.value = { name: file.name, size: file.size, path }
  else void file.arrayBuffer().then((b) => (hFile.value = { name: file.name, size: file.size, bytes: new Uint8Array(b) }))
}
function useDecoded(t: string): void {
  hText.value = t
}
const algTitle = (id: HashAlg) => HASH_ALGS.find((a) => a.id === id)!.title
const copy = props.clip.copy
</script>

<template>
  <div class="hash tw:relative tw:flex-1 tw:min-h-0 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tw:gap-1 tw:bg-border" :class="{ dragging: hDragging }" @dragover.prevent="hDragging = true" @dragleave.self="hDragging = false" @drop.prevent="takeHashFile($event.dataTransfer?.files?.[0])">
    <div class="col tw:flex tw:flex-col tw:gap-6 tw:min-w-0 tw:min-h-0 tw:pt-10 tw:pr-14 tw:pb-14 tw:pl-14 tw:bg-bg tw:overflow-auto">
      <div class="ph tw:flex-none tw:flex tw:items-center tw:gap-10 tw:min-h-26 tw:text-[12.5px] tw:whitespace-nowrap tw:[&:not(textarea)]:shrink-0">
        <b class="tw:text-text-hi">{{ hFile ? 'Файл' : 'Текст' }}</b>
        <span class="grow tw:flex-1"></span>
        <button class="lnk tw:py-2 tw:px-8 tw:text-[12px] tw:inline-flex tw:items-center tw:gap-6" title="Хэш файла (или перетащите файл сюда)" @click="hFileIn?.click()"><Icon name="filePlus" :size="13" />Файл…</button>
      </div>
      <div v-if="hFile" class="hfile tw:flex tw:items-center tw:gap-10 tw:min-h-44 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-12 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-panel tw:text-text-2 tw:whitespace-nowrap tw:[&:not(textarea)]:shrink-0">
        <Icon name="binary" :size="18" />
        <b class="tw:overflow-hidden tw:text-text tw:text-ellipsis" :title="hFile.name">{{ hFile.name }}</b>
        <span class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">{{ fmtSize(hFile.size) }}</span>
        <span class="grow tw:flex-1"></span>
        <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Убрать файл — хэшировать текст" @click="hFile = undefined"><Icon name="x" :size="13" /></button>
      </div>
      <textarea v-else v-model="hText" class="htext tw:resize-none tw:font-data tw:text-[12.5px] tw:leading-[1.5] tw:break-all tw:flex-[0_0_auto] tw:min-h-120 tw:h-[30%] tw:[&:not(textarea)]:shrink-0" spellcheck="false" placeholder="Текст (UTF-8) — его хэши справа. Вставьте уже готовый хэш или закодированную строку — подскажу, что это"></textarea>
      <input class="tw:[&:not(textarea)]:shrink-0" ref="hFileIn" type="file" hidden @change="takeHashFile(($event.target as HTMLInputElement).files?.[0]), (($event.target as HTMLInputElement).value = '')" />
      <label class="fld tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12.5px] tw:[&:not(textarea)]:shrink-0">Ключ HMAC <span class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">(необязательно — тогда HMAC-MD5 / HMAC-SHA…)</span><input class="tw:font-data" v-model="hKey" spellcheck="false" placeholder="секретный ключ" /></label>
      <div v-for="(x, i) in sniffed" :key="i" class="sniff tw:flex tw:flex-col tw:gap-8 tw:py-10 tw:px-12 tw:border tw:border-accent/35 tw:rounded-r2 tw:bg-accent/6 tw:text-[12.5px] tw:[&:not(textarea)]:shrink-0">
        <div class="sh tw:flex tw:items-center tw:gap-6 tw:text-accent-fg"><Icon name="search" :size="12" /><b>{{ x.title }}</b></div>
        <p class="tw:m-0 tw:text-text-2">{{ x.note }}</p>
        <template v-if="x.decoded !== undefined">
          <pre class="tw:max-h-160 tw:m-0 tw:py-8 tw:px-10 tw:overflow-auto tw:rounded-r2 tw:bg-bg tw:text-text tw:font-data tw:text-[12px] tw:whitespace-pre-wrap tw:break-all">{{ x.decoded.length > 600 ? x.decoded.slice(0, 600) + '…' : x.decoded }}</pre>
          <div class="row tw:flex-none tw:flex tw:items-center tw:gap-12 tw:flex-wrap"><button class="tw:inline-flex tw:items-center tw:gap-6" @click="copy(x.decoded)"><Icon name="copy" :size="12" />Копировать</button><button class="tw:inline-flex tw:items-center tw:gap-6" @click="useDecoded(x.decoded)">Хэшировать раскодированное</button></div>
        </template>
        <template v-if="x.kind === 'hash'">
          <label class="fld tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12.5px]">Проверить догадку: исходный текст<input class="tw:font-data" v-model="guess" spellcheck="false" placeholder="например, пароль или строка" /></label>
          <span v-if="guess && guessHit" class="verdict ok tw:flex tw:items-center tw:gap-8 tw:font-semibold tw:text-up-fg"><Icon name="check" :size="14" />Совпало: это {{ algTitle(guessHit) }}{{ hKey ? ' (HMAC)' : '' }} от «{{ guess }}»</span>
          <span v-else-if="guess && guessHit === null" class="verdict err tw:overflow-hidden tw:text-ellipsis tw:flex tw:items-center tw:gap-8 tw:font-semibold tw:text-down-fg">Не совпадает ни с MD5, ни с SHA-1/256/512</span>
        </template>
      </div>
    </div>
    <div class="col tw:flex tw:flex-col tw:gap-6 tw:min-w-0 tw:min-h-0 tw:pt-10 tw:pr-14 tw:pb-14 tw:pl-14 tw:bg-bg tw:overflow-auto">
      <div class="ph tw:flex-none tw:flex tw:items-center tw:gap-10 tw:min-h-26 tw:text-[12.5px] tw:whitespace-nowrap tw:[&:not(textarea)]:shrink-0">
        <b class="tw:text-text-hi">{{ hKey ? 'HMAC' : 'Хэши' }}</b>
        <span class="seg sm tw:inline-flex tw:border tw:border-border-2 tw:rounded-r2 tw:overflow-hidden"><button class="tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text-2 tw:font-data tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg tw:h-24 tw:py-0 tw:px-9 tw:text-[11.5px]" :class="{ on: !hB64 }" @click="hB64 = false">hex</button><button class="tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text-2 tw:font-data tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg tw:h-24 tw:py-0 tw:px-9 tw:text-[11.5px]" :class="{ on: hB64 }" @click="hB64 = true">Base64</button></span>
        <label v-if="!hB64" class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12.5px]"><input v-model="hUpper" type="checkbox" />ABC</label>
        <span v-if="hBusy" class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">считаю…</span>
        <span v-if="hError" class="err tw:text-down-fg tw:overflow-hidden tw:text-ellipsis">{{ hError }}</span>
      </div>
      <div class="hl tw:[&:not(textarea)]:shrink-0 tw:flex tw:flex-col tw:gap-4">
        <div v-for="a in HASH_ALGS" :key="a.id" class="hrow tw:grid tw:grid-cols-[96px_minmax(0,1fr)_28px] tw:items-center tw:gap-10 tw:min-h-34 tw:pt-4 tw:pr-4 tw:pb-4 tw:pl-10 tw:border tw:border-border tw:rounded-r2 tw:bg-panel tw:[&.hit]:border-up tw:[&.hit]:bg-up/8" :class="{ hit: matchAlg === a.id }">
          <span class="hn tw:text-text-2 tw:font-data tw:text-[11.5px]">{{ hKey ? 'HMAC-' : '' }}{{ a.title }}</span>
          <code class="tw:text-text tw:font-data tw:text-[12px] tw:break-all">{{ shown(a.id) || '—' }}</code>
          <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Копировать" :disabled="!shown(a.id)" @click="copy(shown(a.id))"><Icon name="copy" :size="13" /></button>
        </div>
      </div>
      <label class="fld tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12.5px] tw:[&:not(textarea)]:shrink-0">Сравнить с ожидаемым хэшем <span class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">(контрольная сумма файла, хэш из базы…)</span><input class="tw:font-data" v-model="hExpect" spellcheck="false" placeholder="вставьте хэш — hex или Base64" /></label>
      <span v-if="hExpect && matchAlg" class="verdict ok tw:flex tw:items-center tw:gap-8 tw:font-semibold tw:text-up-fg tw:[&:not(textarea)]:shrink-0"><Icon name="check" :size="14" />Совпадает: {{ algTitle(matchAlg) }}</span>
      <span v-else-if="hExpect && (hText || hFile)" class="verdict err tw:overflow-hidden tw:text-ellipsis tw:flex tw:items-center tw:gap-8 tw:font-semibold tw:text-down-fg tw:[&:not(textarea)]:shrink-0">Не совпадает ни с одним</span>
      <p class="note tw:m-0 tw:text-muted tw:[&:not(textarea)]:shrink-0">MD5 и SHA-1 устарели для защиты (известны коллизии), но годятся для контрольных сумм. Хэш необратим: из него нельзя получить исходный текст.</p>
    </div>
    <div v-if="hDragging" class="dropz tw:absolute tw:inset-8 tw:z-5 tw:flex tw:items-center tw:justify-center tw:border-2 tw:border-dashed tw:border-accent/80 tw:rounded-r3 tw:bg-accent/8 tw:text-accent-fg tw:text-[14px] tw:pointer-events-none"><span>Отпустите — посчитаю хэши файла</span></div>
  </div>
</template>
