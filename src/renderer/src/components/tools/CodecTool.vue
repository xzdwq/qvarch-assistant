<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { asText, b64encode, b64ToBytes, bytesToB64, HASH_ALGS, JWT_ALGS, jwtDecode, jwtEncode, jwtTimes, jwtVerify, sniffEncoded, sniffMime, uuid, uuidInfo, type HashAlg } from '@shared/codec'
import CodeArea from '../CodeArea.vue'
import Icon from '../Icon.vue'

/**
 * Кодировки. JWT: a token read into its header and payload — edit either side and the other follows (signed
 * with the secret for HS256/384/512). UUID: made (v4 / v7 / v1), any one read (valid, version, its time).
 * Base64: text or a file (a picture shown) ↔ Base64 both ways. Хэш: MD5 / SHA of a text or a file (HMAC with a
 * key), checked against an expected one; a pasted string is recognised (a hash by its length, Base64, JWT…).
 */
type Tab = 'jwt' | 'uuid' | 'b64' | 'hash'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'jwt', label: 'JWT' },
  { id: 'uuid', label: 'UUID' },
  { id: 'b64', label: 'Base64' },
  { id: 'hash', label: 'Хэш' },
]
const tab = ref<Tab>((localStorage.getItem('qa.tools.codec') as Tab | null) ?? 'jwt')
watch(tab, (v) => {
  try {
    localStorage.setItem('qa.tools.codec', v)
  } catch {
    // fine
  }
})
const copied = ref('')
async function copy(text: string, what = 'Скопировано'): Promise<void> {
  await navigator.clipboard.writeText(text)
  copied.value = what
  setTimeout(() => copied.value === what && (copied.value = ''), 1400)
}
const fmtTime = (t: number) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

// ---------- JWT ----------
const token = ref('')
const header = ref('')
const payload = ref('')
const secret = ref('')
const jwtError = ref('')
const sigOk = ref<boolean | undefined>()
/** Who changed last: the token (→ the parts) or a part (→ the token) — so they do not chase each other. */
let source: 'token' | 'parts' | undefined
const parsed = computed(() => {
  try {
    return { h: JSON.parse(header.value) as Record<string, unknown>, p: JSON.parse(payload.value) as Record<string, unknown> }
  } catch {
    return undefined
  }
})
const alg = computed(() => String(parsed.value?.h.alg ?? ''))
const canSign = computed(() => (JWT_ALGS as string[]).includes(alg.value))
const times = computed(() => (parsed.value ? jwtTimes(parsed.value.p) : []))
watch(token, (t) => {
  if (source === 'parts') return void (source = undefined)
  if (!t.trim()) {
    jwtError.value = ''
    return
  }
  try {
    const j = jwtDecode(t)
    jwtError.value = ''
    source = 'token'
    header.value = JSON.stringify(j.header, null, 2)
    payload.value = JSON.stringify(j.payload, null, 2)
  } catch (e) {
    jwtError.value = e instanceof Error ? e.message : String(e)
  }
})
watch([header, payload], async () => {
  if (source === 'token') return void (source = undefined)
  const p = parsed.value
  if (!p) return
  let sig = ''
  try {
    sig = jwtDecode(token.value).signature
  } catch {
    sig = ''
  }
  const next = await jwtEncode(p.h, p.p, secret.value, sig)
  if (next !== token.value) {
    source = 'parts'
    token.value = next
  }
})
// the secret given: an HS token edited is signed again; the signature checked
watch([token, secret], async ([t, s]) => {
  try {
    sigOk.value = t.trim() ? await jwtVerify(t, s) : undefined
  } catch {
    sigOk.value = undefined
  }
})
async function resign(): Promise<void> {
  const p = parsed.value
  if (!p || !canSign.value || !secret.value) return
  source = 'parts'
  token.value = await jwtEncode(p.h, p.p, secret.value)
}
function setAlg(a: string): void {
  const p = parsed.value
  if (!p) return
  header.value = JSON.stringify({ ...p.h, alg: a }, null, 2)
}
function newToken(): void {
  const now = Math.floor(Date.now() / 1000)
  source = undefined
  header.value = JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2)
  payload.value = JSON.stringify({ sub: '1234567890', name: 'Имя Фамилия', iat: now, exp: now + 3600 }, null, 2)
}
const tokenParts = computed(() => {
  const p = token.value.trim().replace(/^Bearer\s+/i, '').split('.')
  return p.length === 3 ? p : undefined
})

// ---------- UUID ----------
const ver = ref<1 | 4 | 7>(Number(localStorage.getItem('qa.tools.uuidv')) === 7 ? 7 : Number(localStorage.getItem('qa.tools.uuidv')) === 1 ? 1 : 4)
const count = ref(5)
const upper = ref(false)
const noDash = ref(false)
const made = ref<string[]>([])
const style = (u: string) => {
  const s = noDash.value ? u.replace(/-/g, '') : u
  return upper.value ? s.toUpperCase() : s
}
function generate(): void {
  try {
    localStorage.setItem('qa.tools.uuidv', String(ver.value))
  } catch {
    // fine
  }
  made.value = Array.from({ length: Math.min(500, Math.max(1, count.value || 1)) }, () => uuid(ver.value))
}
generate()
const check = ref('')
const info = computed(() => (check.value.trim() ? uuidInfo(check.value) : undefined))
const VERSIONS: Record<number, string> = { 1: 'время + узел', 3: 'MD5 от имени', 4: 'случайный', 5: 'SHA-1 от имени', 6: 'время (упорядоченный v1)', 7: 'время Unix + случайный', 8: 'свой формат' }

// ---------- Base64: a text or a file ----------
const plain = ref('')
const encoded = ref('')
const urlSafe = ref(false)
/** A file's Base64 starts with data:<type>;base64, (to put into HTML / CSS as it is). */
const dataUrl = ref(localStorage.getItem('qa.tools.b64.dataUrl') !== '0')
watch(dataUrl, (v) => {
  try {
    localStorage.setItem('qa.tools.b64.dataUrl', v ? '1' : '0')
  } catch {
    // fine
  }
})
const b64Error = ref('')
interface Bin {
  bytes: Uint8Array
  mime: string
  ext: string
  name: string
  image: boolean
  url?: string
  w?: number
  h?: number
}
/** A file (not a text) on the left: a picture shown, anything else — its type and size. */
const bin = shallowRef<Bin>()
const MAX_FILE = 25 * 1024 * 1024
function setBin(bytes: Uint8Array, name?: string, mimeHint?: string): void {
  if (bin.value?.url) URL.revokeObjectURL(bin.value.url)
  const s = sniffMime(bytes)
  const mime = s?.mime ?? mimeHint ?? 'application/octet-stream'
  const ext = s?.ext ?? (mimeHint?.split('/')[1]?.replace(/\W.*$/, '') || 'bin')
  const b: Bin = { bytes, mime, ext, name: name ?? `файл.${ext}`, image: !!s?.image || mime.startsWith('image/') }
  if (b.image) {
    b.url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
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
const setSide = (r: typeof plain, v: string) => {
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
const fmtSize = (n: number) => (n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(2)} МБ`)
async function saveBin(): Promise<void> {
  const b = bin.value
  if (b) await window.qa.fileSave(b.bytes, b.name, b.ext)
}
/** The picture onto the clipboard (as PNG — what every program takes). */
async function copyImage(): Promise<void> {
  const b = bin.value
  if (!b?.url) return
  let blob = new Blob([b.bytes as BlobPart], { type: b.mime })
  if (b.mime !== 'image/png') {
    const img = new Image()
    img.src = b.url
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    c.getContext('2d')!.drawImage(img, 0, 0)
    blob = await new Promise<Blob>((res, rej) => c.toBlob((x) => (x ? res(x) : rej(new Error('png'))), 'image/png'))
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  copied.value = 'Изображение скопировано'
  setTimeout(() => copied.value === 'Изображение скопировано' && (copied.value = ''), 1400)
}

// ---------- Хэш ----------
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
      if (my === hSeq) hError.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
    } finally {
      if (my === hSeq) hBusy.value = false
    }
  }, 150)
})
const hexToB64 = (hex: string) => bytesToB64(Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)))
const shown = (alg: HashAlg) => {
  const h = hashes.value[alg]
  if (!h) return ''
  return hB64.value ? hexToB64(h) : hUpper.value ? h.toUpperCase() : h
}
/** The expected hash (hex any case, or Base64) — which algorithm gives it. */
const norm = (s: string) => s.trim().replace(/\s+/g, '')
const expectHex = computed(() => {
  const e = norm(hExpect.value)
  if (!e) return ''
  if (/^[0-9a-f]+$/i.test(e)) return e.toLowerCase()
  try {
    return [...b64ToBytes(e).bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return '?'
  }
})
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
  const target = norm(hText.value)
  if (!guess.value || !sniffed.value.some((x) => x.kind === 'hash')) return
  gTimer = setTimeout(async () => {
    const r = await window.qa.hashOf({ text: guess.value }, hKey.value || undefined)
    const hex = /^[0-9a-f]+$/i.test(target) ? target.toLowerCase() : [...b64ToBytes(target).bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    guessHit.value = HASH_ALGS.find((a) => r[a.id] === hex)?.id ?? null
  }, 200)
})
const hFileIn = ref<HTMLInputElement>()
const hDragging = ref(false)
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
</script>

<template>
  <div class="ct">
    <div class="tabs">
      <button v-for="t in TABS" :key="t.id" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
      <span class="grow"></span>
      <span v-if="copied" class="copied">{{ copied }}</span>
    </div>

    <!-- JWT -->
    <div v-if="tab === 'jwt'" class="jwt">
      <div class="col">
        <div class="ph">
          <b>Токен</b>
          <span v-if="jwtError" class="err">{{ jwtError }}</span>
          <span v-else-if="sigOk === true" class="ok"><Icon name="check" :size="12" />Подпись верна</span>
          <span v-else-if="sigOk === false" class="err">Подпись не совпадает с секретом</span>
          <span v-else-if="tokenParts && !canSign" class="muted">{{ alg || '—' }}: подпись не проверить без ключа</span>
          <span class="grow"></span>
          <button class="lnk" @click="newToken">Новый токен</button>
          <button class="ib" title="Копировать токен" :disabled="!token" @click="copy(token, 'Токен скопирован')"><Icon name="copy" :size="13" /></button>
        </div>
        <textarea v-model="token" class="tok" spellcheck="false" placeholder="Вставьте JWT (можно с «Bearer »)"></textarea>
        <div v-if="tokenParts" class="parts"><span class="p1">{{ tokenParts[0] }}</span>.<span class="p2">{{ tokenParts[1] }}</span>.<span class="p3">{{ tokenParts[2] }}</span></div>
        <div class="ph">
          <b>Секрет</b>
          <span class="muted">для {{ JWT_ALGS.join(' / ') }}: проверка и подпись при правке</span>
        </div>
        <div class="sec">
          <input v-model="secret" type="text" spellcheck="false" autocomplete="off" placeholder="your-256-bit-secret" />
          <select :value="canSign ? alg : ''" :disabled="!parsed" title="Алгоритм подписи" @change="setAlg(($event.target as HTMLSelectElement).value)">
            <option v-if="!canSign" value="" disabled>{{ alg || 'алгоритм' }}</option>
            <option v-for="a in JWT_ALGS" :key="a" :value="a">{{ a }}</option>
          </select>
          <button :disabled="!canSign || !secret || !parsed" @click="resign">Подписать</button>
        </div>
        <div v-if="times.length" class="times">
          <div v-for="x in times" :key="x.key"><code>{{ x.key }}</code><span>{{ fmtTime(x.at) }}</span><em :class="{ bad: x.note === 'истёк' || x.note === 'ещё не действует' }">{{ x.note }}</em></div>
        </div>
      </div>
      <div class="col">
        <div class="ph"><b>Заголовок</b><span class="muted">header</span></div>
        <div class="ed sm"><CodeArea v-model="header" lang="json" fill :min-height="0" /></div>
        <div class="ph"><b>Данные</b><span class="muted">payload — правьте, токен обновится</span></div>
        <div class="ed"><CodeArea v-model="payload" lang="json" fill :min-height="0" /></div>
      </div>
    </div>

    <!-- UUID -->
    <div v-else-if="tab === 'uuid'" class="uuid">
      <div class="col">
        <div class="ph"><b>Создать</b></div>
        <div class="row">
          <span class="seg">
            <button v-for="v in [4, 7, 1] as const" :key="v" :class="{ on: ver === v }" :title="v === 4 ? 'Случайный' : v === 7 ? 'По времени, сортируется (для БД)' : 'Время + узел (устаревший)'" @click="(ver = v), generate()">v{{ v }}</button>
          </span>
          <label class="num">Сколько <input v-model.number="count" type="number" min="1" max="500" @change="generate" /></label>
          <label class="chk"><input v-model="upper" type="checkbox" />ПРОПИСНЫЕ</label>
          <label class="chk"><input v-model="noDash" type="checkbox" />Без дефисов</label>
          <span class="grow"></span>
          <button class="primary" @click="generate"><Icon name="refresh" :size="13" />Ещё</button>
          <button @click="copy(made.map(style).join('\n'), 'Все UUID скопированы')"><Icon name="copy" :size="13" />Все</button>
        </div>
        <div class="list">
          <button v-for="(u, i) in made" :key="i" class="uu" title="Скопировать" @click="copy(style(u), 'UUID скопирован')"><code>{{ style(u) }}</code><Icon name="copy" :size="12" /></button>
        </div>
      </div>
      <div class="col">
        <div class="ph"><b>Проверить</b><span class="muted">вставьте UUID — версия, вариант, время</span></div>
        <input v-model="check" class="chkin" spellcheck="false" placeholder="550e8400-e29b-41d4-a716-446655440000" />
        <div v-if="info" class="info">
          <div class="verdict" :class="info.valid ? 'ok' : 'err'"><Icon :name="info.valid ? 'check' : 'x'" :size="14" />{{ info.valid ? 'Корректный UUID' : 'Не корректный UUID' }}</div>
          <template v-if="info.canonical">
            <div class="kv"><span>Вид</span><code>{{ info.canonical }}</code></div>
            <div class="kv"><span>Версия</span><b>v{{ info.version }}<template v-if="VERSIONS[info.version!]"> · {{ VERSIONS[info.version!] }}</template></b></div>
            <div class="kv"><span>Вариант</span><b>{{ info.variant }}</b></div>
            <div v-if="info.time !== undefined" class="kv"><span>Создан</span><b>{{ fmtTime(info.time) }}</b></div>
          </template>
          <p v-if="info.note" class="note">{{ info.note }}</p>
        </div>
      </div>
    </div>

    <!-- Base64 -->
    <div v-else-if="tab === 'b64'" class="b64" :class="{ dragging }" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="onB64Drop">
      <div class="col">
        <div class="ph">
          <b>{{ bin ? (bin.image ? 'Изображение' : 'Файл') : 'Текст' }}</b>
          <span class="grow"></span>
          <button class="lnk" title="Изображение или любой файл → Base64 (или перетащите его сюда, или вставьте картинку Ctrl+V)" @click="fileIn?.click()"><Icon name="image" :size="13" />Файл…</button>
          <button v-if="!bin" class="ib" title="Копировать" :disabled="!plain" @click="copy(plain)"><Icon name="copy" :size="13" /></button>
        </div>
        <div v-if="bin" class="binv">
          <div class="bimg" :class="{ none: !bin.url }">
            <img v-if="bin.url" :src="bin.url" alt="" />
            <span v-else><Icon name="binary" :size="22" />Двоичные данные</span>
          </div>
          <div class="bmeta">
            <b :title="bin.name">{{ bin.name }}</b>
            <span>{{ bin.mime }} · {{ fmtSize(bin.bytes.length) }}<template v-if="bin.w"> · {{ bin.w }}×{{ bin.h }}</template></span>
          </div>
          <div class="row">
            <button @click="saveBin"><Icon name="download" :size="13" />Сохранить файл…</button>
            <button v-if="bin.image" @click="copyImage"><Icon name="copy" :size="13" />Копировать изображение</button>
            <button @click="clearB64"><Icon name="x" :size="13" />Убрать</button>
          </div>
        </div>
        <textarea v-else v-model="plain" spellcheck="false" placeholder="Обычный текст (UTF-8) — или перетащите сюда изображение / файл, или вставьте картинку (Ctrl+V)" @paste="onPlainPaste"></textarea>
        <input ref="fileIn" type="file" hidden @change="takeFile(($event.target as HTMLInputElement).files?.[0]), (($event.target as HTMLInputElement).value = '')" />
      </div>
      <div class="col">
        <div class="ph">
          <b>Base64</b>
          <label class="chk" title="- и _ вместо + и /, без = в конце (как в JWT и адресах)"><input v-model="urlSafe" type="checkbox" />URL-safe</label>
          <label v-if="bin" class="chk" :class="{ off: urlSafe }" title="С префиксом data:тип;base64, — готово для HTML (src) и CSS (url())"><input v-model="dataUrl" type="checkbox" :disabled="urlSafe" />data: URL</label>
          <span v-if="b64Error" class="err" :title="b64Error">{{ b64Error }}</span>
          <span class="grow"></span>
          <span v-if="encoded.length > 2000" class="muted">{{ fmtSize(encoded.length) }}</span>
          <button class="ib" title="Копировать" :disabled="!encoded" @click="copy(encoded)"><Icon name="copy" :size="13" /></button>
        </div>
        <textarea v-model="encoded" spellcheck="false" placeholder="Base64 или data:…;base64,… — текст или изображение слева появится само"></textarea>
      </div>
      <div v-if="dragging" class="dropz"><span>Отпустите — файл превратится в Base64</span></div>
    </div>

    <!-- Хэш -->
    <div v-else class="hash" :class="{ dragging: hDragging }" @dragover.prevent="hDragging = true" @dragleave.self="hDragging = false" @drop.prevent="takeHashFile($event.dataTransfer?.files?.[0])">
      <div class="col">
        <div class="ph">
          <b>{{ hFile ? 'Файл' : 'Текст' }}</b>
          <span class="grow"></span>
          <button class="lnk" title="Хэш файла (или перетащите файл сюда)" @click="hFileIn?.click()"><Icon name="filePlus" :size="13" />Файл…</button>
        </div>
        <div v-if="hFile" class="hfile">
          <Icon name="binary" :size="18" />
          <b :title="hFile.name">{{ hFile.name }}</b>
          <span class="muted">{{ fmtSize(hFile.size) }}</span>
          <span class="grow"></span>
          <button class="ib" title="Убрать файл — хэшировать текст" @click="hFile = undefined"><Icon name="x" :size="13" /></button>
        </div>
        <textarea v-else v-model="hText" class="htext" spellcheck="false" placeholder="Текст (UTF-8) — его хэши справа. Вставьте уже готовый хэш или закодированную строку — подскажу, что это"></textarea>
        <input ref="hFileIn" type="file" hidden @change="takeHashFile(($event.target as HTMLInputElement).files?.[0]), (($event.target as HTMLInputElement).value = '')" />
        <label class="fld">Ключ HMAC <span class="muted">(необязательно — тогда HMAC-MD5 / HMAC-SHA…)</span><input v-model="hKey" spellcheck="false" placeholder="секретный ключ" /></label>
        <div v-for="(x, i) in sniffed" :key="i" class="sniff">
          <div class="sh"><Icon name="search" :size="12" /><b>{{ x.title }}</b></div>
          <p>{{ x.note }}</p>
          <template v-if="x.decoded !== undefined">
            <pre>{{ x.decoded.length > 600 ? x.decoded.slice(0, 600) + '…' : x.decoded }}</pre>
            <div class="row"><button @click="copy(x.decoded)"><Icon name="copy" :size="12" />Копировать</button><button @click="useDecoded(x.decoded)">Хэшировать раскодированное</button></div>
          </template>
          <template v-if="x.kind === 'hash'">
            <label class="fld">Проверить догадку: исходный текст<input v-model="guess" spellcheck="false" placeholder="например, пароль или строка" /></label>
            <span v-if="guess && guessHit" class="verdict ok"><Icon name="check" :size="14" />Совпало: это {{ HASH_ALGS.find((a) => a.id === guessHit)!.title }}{{ hKey ? ' (HMAC)' : '' }} от «{{ guess }}»</span>
            <span v-else-if="guess && guessHit === null" class="verdict err">Не совпадает ни с MD5, ни с SHA-1/256/512</span>
          </template>
        </div>
      </div>
      <div class="col">
        <div class="ph">
          <b>{{ hKey ? 'HMAC' : 'Хэши' }}</b>
          <span class="seg sm"><button :class="{ on: !hB64 }" @click="hB64 = false">hex</button><button :class="{ on: hB64 }" @click="hB64 = true">Base64</button></span>
          <label v-if="!hB64" class="chk"><input v-model="hUpper" type="checkbox" />ABC</label>
          <span v-if="hBusy" class="muted">считаю…</span>
          <span v-if="hError" class="err">{{ hError }}</span>
        </div>
        <div class="hl">
          <div v-for="a in HASH_ALGS" :key="a.id" class="hrow" :class="{ hit: matchAlg === a.id }">
            <span class="hn">{{ hKey ? 'HMAC-' : '' }}{{ a.title }}</span>
            <code>{{ shown(a.id) || '—' }}</code>
            <button class="ib" title="Копировать" :disabled="!shown(a.id)" @click="copy(shown(a.id))"><Icon name="copy" :size="13" /></button>
          </div>
        </div>
        <label class="fld">Сравнить с ожидаемым хэшем <span class="muted">(контрольная сумма файла, хэш из базы…)</span><input v-model="hExpect" spellcheck="false" placeholder="вставьте хэш — hex или Base64" /></label>
        <span v-if="hExpect && matchAlg" class="verdict ok"><Icon name="check" :size="14" />Совпадает: {{ HASH_ALGS.find((a) => a.id === matchAlg)!.title }}</span>
        <span v-else-if="hExpect && (hText || hFile)" class="verdict err">Не совпадает ни с одним</span>
        <p class="note">MD5 и SHA-1 устарели для защиты (известны коллизии), но годятся для контрольных сумм. Хэш необратим: из него нельзя получить исходный текст.</p>
      </div>
      <div v-if="hDragging" class="dropz"><span>Отпустите — посчитаю хэши файла</span></div>
    </div>
  </div>
</template>

<style scoped>
.ct {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.tabs {
  flex: none;
  display: flex;
  align-items: center;
  height: 38px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}
.tabs button {
  height: 38px;
  padding: 0 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.tabs button.on {
  color: var(--text-hi);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.copied {
  color: var(--up-fg);
  font-size: 12px;
}
.grow {
  flex: 1;
}
.jwt,
.uuid,
.b64,
.hash {
  position: relative;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1px;
  background: var(--border);
}
.col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  padding: 10px 14px 14px;
  background: var(--bg);
  overflow: auto;
}
.ph {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 26px;
  font-size: 12.5px;
  white-space: nowrap;
}
.ph b {
  color: var(--text-hi);
}
.muted {
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
}
.err {
  color: var(--down-fg);
  overflow: hidden;
  text-overflow: ellipsis;
}
.ok {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--up-fg);
}
textarea {
  flex: 1;
  min-height: 90px;
  resize: none;
  font-family: var(--font-data);
  font-size: 12.5px;
  line-height: 1.5;
  word-break: break-all;
}
.tok {
  flex: 0 0 120px;
}
.parts {
  flex: none;
  max-height: 120px;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  font-family: var(--font-data);
  font-size: 12px;
  word-break: break-all;
  color: var(--muted);
}
.p1 {
  color: #ff7b72;
}
.p2 {
  color: #d2a8ff;
}
.p3 {
  color: #18e0ff;
}
.sec {
  flex: none;
  display: flex;
  gap: 6px;
}
.sec input {
  flex: 1;
  min-width: 0;
  font-family: var(--font-data);
}
.times {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 6px;
  font-size: 12.5px;
}
.times div {
  display: flex;
  align-items: center;
  gap: 10px;
}
.times code {
  min-width: 70px;
  color: var(--text-2);
  font-family: var(--font-data);
}
.times em {
  font-style: normal;
  color: var(--up-fg);
}
.times em.bad {
  color: var(--down-fg);
}
.ed {
  flex: 1;
  min-height: 120px;
}
.ed.sm {
  flex: 0 0 120px;
}
.ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.ib:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.ib:disabled {
  opacity: 0.35;
}
.lnk {
  padding: 2px 8px;
  font-size: 12px;
}
.row {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.row button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  overflow: hidden;
}
.seg button {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-2);
  font-family: var(--font-data);
}
.seg button.on {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--accent-fg);
}
.num {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
  font-size: 12.5px;
}
.num input {
  width: 64px;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
  font-size: 12.5px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.uu {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--panel);
  color: var(--text);
}
.uu code {
  font-family: var(--font-data);
  font-size: 13px;
}
.uu :deep(svg) {
  color: var(--muted);
  opacity: 0;
}
.uu:hover :deep(svg) {
  opacity: 1;
}
.chkin {
  flex: none;
  font-family: var(--font-data);
}
.info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
  font-size: 13px;
}
.verdict {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.verdict.ok {
  color: var(--up-fg);
}
.verdict.err {
  color: var(--down-fg);
}
.kv {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  gap: 10px;
}
.kv span {
  color: var(--text-2);
}
.kv code {
  font-family: var(--font-data);
}
.kv b {
  font-weight: 500;
}
.note {
  margin: 0;
  color: var(--muted);
}
.lnk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.chk.off {
  opacity: 0.45;
}
.dropz {
  position: absolute;
  inset: 8px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed rgb(var(--accent-rgb) / 0.8);
  border-radius: var(--r3);
  background: rgb(var(--accent-rgb) / 0.08);
  color: var(--accent-fg);
  font-size: 14px;
  pointer-events: none;
}
.binv {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.bimg {
  flex: 1;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  /* a checkerboard under see-through pictures */
  background: repeating-conic-gradient(rgba(255, 255, 255, 0.06) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px;
}
.bimg img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.bimg.none span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
}
.bmeta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 12.5px;
}
.bmeta b {
  overflow: hidden;
  color: var(--text-hi);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bmeta span {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.htext {
  flex: 0 0 auto;
  min-height: 120px;
  height: 30%;
}
.hfile {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 6px 0 12px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: var(--panel);
  color: var(--text-2);
  white-space: nowrap;
}
.hfile b {
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--text-2);
  font-size: 12.5px;
}
.fld input {
  font-family: var(--font-data);
}
.sniff {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid rgb(var(--accent-rgb) / 0.35);
  border-radius: var(--r2);
  background: rgb(var(--accent-rgb) / 0.06);
  font-size: 12.5px;
}
.sniff .sh {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent-fg);
}
.sniff p {
  margin: 0;
  color: var(--text-2);
}
.sniff pre {
  max-height: 160px;
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  border-radius: var(--r2);
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.seg.sm button {
  height: 24px;
  padding: 0 9px;
  font-size: 11.5px;
}
/* (in a column that scrolls: nothing is squeezed) */
.hash .col > :not(textarea),
.b64 .col > .ph {
  flex-shrink: 0;
}
.hl {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hrow {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 4px 4px 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--panel);
}
.hrow.hit {
  border-color: var(--up);
  background: rgba(0, 230, 118, 0.08);
}
.hn {
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.hrow code {
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12px;
  word-break: break-all;
}
</style>
