<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { asText, b64encode, b64ToBytes, bytesToB64, sniffMime } from '@shared/codec'
import Icon from '../../Icon.vue'
import { describeBytes, MAX_FILE, pngBlobOf, type Bin } from './binaryFile'
import { fmtSize } from '@shared/codecText'
import type { CopyNote } from './useCopyNote'

/** Base64: text or a file (a picture shown) ↔ Base64 both ways; URL-safe; a file's Base64 as a data: URL. */
const props = defineProps<{ clip: CopyNote }>()
const DATA_URL_KEY = 'qa.tools.b64.dataUrl'
const plain = ref('')
const encoded = ref('')
const urlSafe = ref(false)
/** A file's Base64 starts with data:<type>;base64, (to put into HTML / CSS as it is). */
const dataUrl = ref(localStorage.getItem(DATA_URL_KEY) !== '0')
watch(dataUrl, (v) => {
  try {
    localStorage.setItem(DATA_URL_KEY, v ? '1' : '0')
  } catch {
    // fine
  }
})
const b64Error = ref('')
/** A file (not a text) on the left: a picture shown, anything else — its type and size. */
const bin = shallowRef<Bin>()
function setBin(bytes: Uint8Array, name?: string, mimeHint?: string): void {
  if (bin.value?.url) URL.revokeObjectURL(bin.value.url)
  const b: Bin = describeBytes(bytes, name, mimeHint)
  if (b.image) {
    b.url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: b.mime }))
    const img = new Image()
    img.onload = () => bin.value === b && (bin.value = { ...b, w: img.naturalWidth, h: img.naturalHeight })
    img.src = b.url
  }
  bin.value = b
}
function clearB64(): void {
  dropBin()
  setSide(encoded, '')
  setSide(plain, '')
  b64Error.value = ''
}
function dropBin(): void {
  if (bin.value?.url) URL.revokeObjectURL(bin.value.url)
  bin.value = undefined
}
onBeforeUnmount(dropBin)
// one side changed by the user → the other one written (the writes are muted: no echo back)
let mute = false
const setSide = (r: Ref<string>, v: string) => {
  mute = true
  r.value = v
  mute = false
}
function encodeNow(): void {
  b64Error.value = ''
  const b = bin.value
  if (b) setSide(encoded, (dataUrl.value && !urlSafe.value ? `data:${b.mime};base64,` : '') + bytesToB64(b.bytes, urlSafe.value))
  else setSide(encoded, b64encode(plain.value, urlSafe.value))
}
watch(plain, () => {
  if (mute) return
  dropBin()
  encodeNow()
}, { flush: 'sync' })
watch([urlSafe, dataUrl], encodeNow)
watch(encoded, (e) => {
  if (mute) return
  b64Error.value = ''
  if (!e.trim()) {
    dropBin()
    return setSide(plain, '')
  }
  try {
    const { bytes, mime } = b64ToBytes(e)
    const text = sniffMime(bytes) ? undefined : asText(bytes)
    if (text !== undefined && !mime) {
      dropBin()
      return setSide(plain, text)
    }
    // a picture or other binary data: shown as a file
    setBin(bytes, undefined, mime)
    setSide(plain, '')
  } catch (err) {
    b64Error.value = err instanceof Error ? err.message : String(err)
  }
}, { flush: 'sync' })
const fileIn = ref<HTMLInputElement>()
const dragging = ref(false)
async function takeFile(file: File | undefined): Promise<void> {
  dragging.value = false
  if (!file) return
  if (file.size > MAX_FILE) {
    b64Error.value = `Файл больше ${MAX_FILE / 1024 / 1024} МБ — Base64 такого размера не нужен в тексте`
    return
  }
  setBin(new Uint8Array(await file.arrayBuffer()), file.name, file.type || undefined)
  setSide(plain, '')
  encodeNow()
}
function onB64Drop(e: DragEvent): void {
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) void takeFile(file)
}
/** A picture pasted into the text: taken as a file. */
function onPlainPaste(e: ClipboardEvent): void {
  const file = [...(e.clipboardData?.files ?? [])][0]
  if (!file || e.clipboardData?.getData('text/plain')) return
  e.preventDefault()
  void takeFile(file)
}
async function saveBin(): Promise<void> {
  const b = bin.value
  if (b) await window.qa.fileSave(b.bytes, b.name, b.ext)
}
/** The picture onto the clipboard (as PNG — what every program takes). */
async function copyImage(): Promise<void> {
  const b = bin.value
  if (!b?.url) return
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': await pngBlobOf(b) })])
  props.clip.show('Изображение скопировано')
}
const copy = props.clip.copy
</script>

<template>
  <div class="b64 tw:relative tw:flex-1 tw:min-h-0 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tw:gap-1 tw:bg-border" :class="{ dragging }" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="onB64Drop">
    <div class="col tw:flex tw:flex-col tw:gap-6 tw:min-w-0 tw:min-h-0 tw:pt-10 tw:pr-14 tw:pb-14 tw:pl-14 tw:bg-bg tw:overflow-auto">
      <div class="ph tw:flex-none tw:flex tw:items-center tw:gap-10 tw:min-h-26 tw:text-[12.5px] tw:whitespace-nowrap tw:[&&]:shrink-0">
        <b class="tw:text-text-hi">{{ bin ? (bin.image ? 'Изображение' : 'Файл') : 'Текст' }}</b>
        <span class="grow tw:flex-1"></span>
        <button class="lnk tw:py-2 tw:px-8 tw:text-[12px] tw:inline-flex tw:items-center tw:gap-6" title="Изображение или любой файл → Base64 (или перетащите его сюда, или вставьте картинку Ctrl+V)" @click="fileIn?.click()"><Icon name="image" :size="13" />Файл…</button>
        <button v-if="!bin" class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Копировать" :disabled="!plain" @click="copy(plain)"><Icon name="copy" :size="13" /></button>
      </div>
      <div v-if="bin" class="binv tw:flex-1 tw:min-h-0 tw:flex tw:flex-col tw:gap-10">
        <div class="bimg tw:group/bimg tw:flex-1 tw:min-h-120 tw:flex tw:items-center tw:justify-center tw:overflow-hidden tw:border tw:border-border tw:rounded-r2 tw:[background:repeating-conic-gradient(rgba(255,255,255,0.06)_0%_25%,transparent_0%_50%)_0_0/16px_16px]" :class="{ none: !bin.url }">
          <img class="tw:max-w-full tw:max-h-full tw:object-contain" v-if="bin.url" :src="bin.url" alt="" />
          <span class="tw:group-[.none]/bimg:inline-flex tw:group-[.none]/bimg:items-center tw:group-[.none]/bimg:gap-8 tw:group-[.none]/bimg:text-muted" v-else><Icon name="binary" :size="22" />Двоичные данные</span>
        </div>
        <div class="bmeta tw:flex tw:flex-col tw:gap-2 tw:min-w-0 tw:text-[12.5px]">
          <b class="tw:overflow-hidden tw:text-text-hi tw:text-ellipsis tw:whitespace-nowrap" :title="bin.name">{{ bin.name }}</b>
          <span class="tw:text-muted tw:font-data tw:text-[11.5px]">{{ bin.mime }} · {{ fmtSize(bin.bytes.length) }}<template v-if="bin.w"> · {{ bin.w }}×{{ bin.h }}</template></span>
        </div>
        <div class="row tw:flex-none tw:flex tw:items-center tw:gap-12 tw:flex-wrap">
          <button class="tw:inline-flex tw:items-center tw:gap-6" @click="saveBin"><Icon name="download" :size="13" />Сохранить файл…</button>
          <button class="tw:inline-flex tw:items-center tw:gap-6" v-if="bin.image" @click="copyImage"><Icon name="copy" :size="13" />Копировать изображение</button>
          <button class="tw:inline-flex tw:items-center tw:gap-6" @click="clearB64"><Icon name="x" :size="13" />Убрать</button>
        </div>
      </div>
      <textarea class="tw:flex-1 tw:min-h-90 tw:resize-none tw:font-data tw:text-[12.5px] tw:leading-[1.5] tw:break-all" v-else v-model="plain" spellcheck="false" placeholder="Обычный текст (UTF-8) — или перетащите сюда изображение / файл, или вставьте картинку (Ctrl+V)" @paste="onPlainPaste"></textarea>
      <input ref="fileIn" type="file" hidden @change="takeFile(($event.target as HTMLInputElement).files?.[0]), (($event.target as HTMLInputElement).value = '')" />
    </div>
    <div class="col tw:flex tw:flex-col tw:gap-6 tw:min-w-0 tw:min-h-0 tw:pt-10 tw:pr-14 tw:pb-14 tw:pl-14 tw:bg-bg tw:overflow-auto">
      <div class="ph tw:flex-none tw:flex tw:items-center tw:gap-10 tw:min-h-26 tw:text-[12.5px] tw:whitespace-nowrap tw:[&&]:shrink-0">
        <b class="tw:text-text-hi">Base64</b>
        <label class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12.5px]" title="- и _ вместо + и /, без = в конце (как в JWT и адресах)"><input v-model="urlSafe" type="checkbox" />URL-safe</label>
        <label v-if="bin" class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12.5px] tw:[&.off]:opacity-45" :class="{ off: urlSafe }" title="С префиксом data:тип;base64, — готово для HTML (src) и CSS (url())"><input v-model="dataUrl" type="checkbox" :disabled="urlSafe" />data: URL</label>
        <span v-if="b64Error" class="err tw:text-down-fg tw:overflow-hidden tw:text-ellipsis" :title="b64Error">{{ b64Error }}</span>
        <span class="grow tw:flex-1"></span>
        <span v-if="encoded.length > 2000" class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">{{ fmtSize(encoded.length) }}</span>
        <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Копировать" :disabled="!encoded" @click="copy(encoded)"><Icon name="copy" :size="13" /></button>
      </div>
      <textarea class="tw:flex-1 tw:min-h-90 tw:resize-none tw:font-data tw:text-[12.5px] tw:leading-[1.5] tw:break-all" v-model="encoded" spellcheck="false" placeholder="Base64 или data:…;base64,… — текст или изображение слева появится само"></textarea>
    </div>
    <div v-if="dragging" class="dropz tw:absolute tw:inset-8 tw:z-5 tw:flex tw:items-center tw:justify-center tw:border-2 tw:border-dashed tw:border-accent/80 tw:rounded-r3 tw:bg-accent/8 tw:text-accent-fg tw:text-[14px] tw:pointer-events-none"><span>Отпустите — файл превратится в Base64</span></div>
  </div>
</template>
