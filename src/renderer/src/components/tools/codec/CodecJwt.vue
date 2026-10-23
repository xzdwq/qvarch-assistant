<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { JWT_ALGS, jwtDecode, jwtEncode, jwtTimes, jwtVerify } from '@shared/codec'
import CodeArea from '../../CodeArea.vue'
import Icon from '../../Icon.vue'
import { fmtTime } from '@shared/codecText'
import type { CopyNote } from './useCopyNote'

/**
 * JWT: a token read into its header and payload — edit either side and the other follows (signed with the
 * secret for HS256/384/512); the signature checked, the times (iat / exp / nbf) read.
 */
const props = defineProps<{ clip: CopyNote }>()
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
/** The token signed again with the secret. */
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
/** A sample token to start from (valid for an hour). */
function newToken(): void {
  const now = Math.floor(Date.now() / 1000)
  source = undefined
  header.value = JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2)
  payload.value = JSON.stringify({ sub: '1234567890', name: 'Имя Фамилия', iat: now, exp: now + 3600 }, null, 2)
}
/** The token's three parts (shown coloured). */
const tokenParts = computed(() => {
  const p = token.value.trim().replace(/^Bearer\s+/i, '').split('.')
  return p.length === 3 ? p : undefined
})
const copy = props.clip.copy
</script>

<template>
  <div class="jwt tw:relative tw:flex-1 tw:min-h-0 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tw:gap-1 tw:bg-border">
    <div class="col tw:flex tw:flex-col tw:gap-6 tw:min-w-0 tw:min-h-0 tw:pt-10 tw:pr-14 tw:pb-14 tw:pl-14 tw:bg-bg tw:overflow-auto">
      <div class="ph tw:flex-none tw:flex tw:items-center tw:gap-10 tw:min-h-26 tw:text-[12.5px] tw:whitespace-nowrap">
        <b class="tw:text-text-hi">Токен</b>
        <span v-if="jwtError" class="err tw:text-down-fg tw:overflow-hidden tw:text-ellipsis">{{ jwtError }}</span>
        <span v-else-if="sigOk === true" class="ok tw:inline-flex tw:items-center tw:gap-4 tw:text-up-fg"><Icon name="check" :size="12" />Подпись верна</span>
        <span v-else-if="sigOk === false" class="err tw:text-down-fg tw:overflow-hidden tw:text-ellipsis">Подпись не совпадает с секретом</span>
        <span v-else-if="tokenParts && !canSign" class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">{{ alg || '—' }}: подпись не проверить без ключа</span>
        <span class="grow tw:flex-1"></span>
        <button class="lnk tw:py-2 tw:px-8 tw:text-[12px] tw:inline-flex tw:items-center tw:gap-6" @click="newToken">Новый токен</button>
        <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Копировать токен" :disabled="!token" @click="copy(token, 'Токен скопирован')"><Icon name="copy" :size="13" /></button>
      </div>
      <textarea v-model="token" class="tok tw:min-h-90 tw:resize-none tw:font-data tw:text-[12.5px] tw:leading-[1.5] tw:break-all tw:flex-[0_0_120px]" spellcheck="false" placeholder="Вставьте JWT (можно с «Bearer »)"></textarea>
      <div v-if="tokenParts" class="parts tw:flex-none tw:max-h-120 tw:overflow-auto tw:py-8 tw:px-10 tw:border tw:border-border tw:rounded-r2 tw:font-data tw:text-[12px] tw:break-all tw:text-muted"><span class="p1 tw:text-(--jwt-header)">{{ tokenParts[0] }}</span>.<span class="p2 tw:text-(--jwt-payload)">{{ tokenParts[1] }}</span>.<span class="p3 tw:text-(--jwt-signature)">{{ tokenParts[2] }}</span></div>
      <div class="ph tw:flex-none tw:flex tw:items-center tw:gap-10 tw:min-h-26 tw:text-[12.5px] tw:whitespace-nowrap">
        <b class="tw:text-text-hi">Секрет</b>
        <span class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">для {{ JWT_ALGS.join(' / ') }}: проверка и подпись при правке</span>
      </div>
      <div class="sec tw:flex-none tw:flex tw:gap-6">
        <input class="tw:flex-1 tw:min-w-0 tw:font-data" v-model="secret" type="text" spellcheck="false" autocomplete="off" placeholder="your-256-bit-secret" />
        <select :value="canSign ? alg : ''" :disabled="!parsed" title="Алгоритм подписи" @change="setAlg(($event.target as HTMLSelectElement).value)">
          <option v-if="!canSign" value="" disabled>{{ alg || 'алгоритм' }}</option>
          <option v-for="a in JWT_ALGS" :key="a" :value="a">{{ a }}</option>
        </select>
        <button :disabled="!canSign || !secret || !parsed" @click="resign">Подписать</button>
      </div>
      <div v-if="times.length" class="times tw:flex-none tw:flex tw:flex-col tw:gap-4 tw:pt-6 tw:text-[12.5px]">
        <div class="tw:flex tw:items-center tw:gap-10" v-for="x in times" :key="x.key"><code class="tw:min-w-70 tw:text-text-2 tw:font-data">{{ x.key }}</code><span>{{ fmtTime(x.at) }}</span><em class="tw:not-italic tw:text-up-fg tw:[&.bad]:text-down-fg" :class="{ bad: x.note === 'истёк' || x.note === 'ещё не действует' }">{{ x.note }}</em></div>
      </div>
    </div>
    <div class="col tw:flex tw:flex-col tw:gap-6 tw:min-w-0 tw:min-h-0 tw:pt-10 tw:pr-14 tw:pb-14 tw:pl-14 tw:bg-bg tw:overflow-auto">
      <div class="ph tw:flex-none tw:flex tw:items-center tw:gap-10 tw:min-h-26 tw:text-[12.5px] tw:whitespace-nowrap"><b class="tw:text-text-hi">Заголовок</b><span class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">header</span></div>
      <div class="ed sm tw:min-h-120 tw:flex-[0_0_120px]"><CodeArea v-model="header" lang="json" fill :min-height="0" /></div>
      <div class="ph tw:flex-none tw:flex tw:items-center tw:gap-10 tw:min-h-26 tw:text-[12.5px] tw:whitespace-nowrap"><b class="tw:text-text-hi">Данные</b><span class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">payload — правьте, токен обновится</span></div>
      <div class="ed tw:flex-1 tw:min-h-120"><CodeArea v-model="payload" lang="json" fill :min-height="0" /></div>
    </div>
  </div>
</template>
