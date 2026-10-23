<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { remoteError } from '../../../shared/remoteError'
import { DB_DEFAULTS, DB_KINDS, SSL_MODES, type DbConn, type DbKind } from '@shared/sql'
import { connWhere, dbConns, kindTitle, loadConns } from '@renderer/lib/sqlDb'
import Icon from '@renderer/components/Icon.vue'

/**
 * «Базы данных»: the connections a note's queries go by (by name: ```sql db=<name>). The password is kept encrypted
 * by Windows and never comes back here; every query is read-only, one connection per query.
 */
const props = defineProps<{ current?: string }>()
const emit = defineEmits<{ pick: [name: string] }>()
void loadConns()
const blank = (): DbConn => ({ id: '', name: '', kind: 'pg', host: 'localhost', port: 5432, ssl: 'off', timeoutSec: DB_DEFAULTS.timeoutSec, lockSec: DB_DEFAULTS.lockSec, maxRows: DB_DEFAULTS.maxRows })
const edit = ref<DbConn>()
const err = ref('')
const test = ref<{ ok: boolean; text: string }>()
const busy = ref(false)
watch(
  () => dbConns.value.length,
  (n) => n === 0 && !edit.value && (edit.value = blank()),
  { immediate: true },
)
function open(c?: DbConn): void {
  err.value = ''
  test.value = undefined
  edit.value = c ? { ...c, password: undefined } : blank()
}
function setKind(k: DbKind): void {
  if (!edit.value) return
  edit.value.kind = k
  edit.value.port = DB_KINDS.find((x) => x.id === k)?.port
}
async function save(): Promise<boolean> {
  if (!edit.value) return false
  err.value = ''
  try {
    dbConns.value = await window.qa.sql('save', JSON.parse(JSON.stringify(edit.value)) as DbConn)
    const saved = dbConns.value.find((c) => c.name === edit.value!.name.trim())
    if (saved) edit.value = { ...saved, password: undefined }
    return true
  } catch (e) {
    err.value = remoteError(e)
    return false
  }
}
/** Saved, then tried: a query that reads nothing (SELECT 1) — the way, the login, the server's version. */
async function check(): Promise<void> {
  if (!(await save()) || !edit.value) return
  busy.value = true
  test.value = undefined
  const r = await window.qa.sql('run', `test#${edit.value.id}`, edit.value.name, 'select 1', [], 'run')
  busy.value = false
  test.value = r.ok ? { ok: true, text: `Подключение работает · ${r.run?.server ?? ''} · ${r.ms} мс` } : { ok: false, text: r.error ?? 'Ошибка' }
}
async function remove(c: DbConn): Promise<void> {
  if (!confirm(`Удалить подключение «${c.name}»? Блоки с db=${c.name} перестанут выполняться, пока его не добавят снова.`)) return
  dbConns.value = await window.qa.sql('remove', c.id)
  if (edit.value?.id === c.id) edit.value = undefined
}
const isNew = computed(() => !edit.value?.id)
</script>

<template>
  <div class="dbc tw:flex tw:flex-col tw:gap-6 tw:py-8 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-[12.5px]">
    <div class="dbc-head tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
      <b>Базы данных</b>
      <span class="muted tw:text-muted">только чтение · отдельное соединение на каждый запрос</span>
      <span class="grow tw:flex-1"></span>
      <button class="pill tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:hover:border-accent tw:hover:text-text tw:hover:enabled:bg-hover" @click="open()"><Icon name="plus" :size="12" />подключение</button>
    </div>
    <div v-for="c in dbConns" :key="c.id" class="dbc-row tw:group/dbc-row tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap tw:border-t tw:border-t-border tw:pt-4" :class="{ on: edit?.id === c.id, cur: c.name === props.current }">
      <button class="nm tw:flex tw:flex-1 tw:items-baseline tw:gap-8 tw:min-w-0 tw:py-2 tw:px-0 tw:overflow-hidden tw:border-0 tw:[background:none] tw:text-text tw:text-left tw:text-ellipsis tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :title="`В заметке: db=${c.name}`" @click="open(c)">
        <b class="tw:group-[.on]/dbc-row:text-accent tw:group-[.cur]/dbc-row:after:content-['_·_в_этом_блоке'] tw:group-[.cur]/dbc-row:after:text-muted tw:group-[.cur]/dbc-row:after:font-normal">{{ c.name }}</b><span class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">{{ kindTitle(c.kind) }} · {{ connWhere(c) }}</span><span v-if="c.prod" class="prod tw:flex-none tw:py-0 tw:px-6 tw:rounded-[8px] tw:bg-[color-mix(in_srgb,var(--warn-fg)_18%,transparent)] tw:text-warn-fg tw:text-[11px]">прод</span>
      </button>
      <button v-if="c.name !== props.current" class="pill tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:hover:border-accent tw:hover:text-text tw:hover:enabled:bg-hover" title="Этот блок — через это подключение" @click="emit('pick', c.name)">выбрать</button>
      <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Удалить" @click="remove(c)"><Icon name="x" :size="12" /></button>
    </div>

    <div v-if="edit" class="dbc-form tw:flex tw:flex-wrap tw:gap-y-6 tw:gap-x-12 tw:pt-6 tw:border-t tw:border-t-border">
      <label class="tw:flex tw:items-center tw:gap-6"><span class="tw:text-text-2">Имя</span><input class="tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="edit.name" placeholder="app-dev (в заметке: db=app-dev)" spellcheck="false" /></label>
      <label class="tw:flex tw:items-center tw:gap-6"
        ><span class="tw:text-text-2">СУБД</span
        ><select class="tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" :value="edit.kind" @change="setKind(($event.target as HTMLSelectElement).value as DbKind)">
          <option v-for="k in DB_KINDS" :key="k.id" :value="k.id">{{ k.title }}</option>
        </select></label
      >
      <template v-if="edit.kind === 'sqlite'">
        <label class="wide tw:flex tw:items-center tw:gap-6 tw:flex-[1_1_100%]"><span class="tw:text-text-2">Файл</span><input class="tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:flex-1" v-model="edit.file" placeholder="C:\путь\к\базе.sqlite" spellcheck="false" /></label>
      </template>
      <template v-else>
        <label class="tw:flex tw:items-center tw:gap-6"><span class="tw:text-text-2">Хост</span><input class="tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="edit.host" spellcheck="false" /></label>
        <label class="tw:flex tw:items-center tw:gap-6"><span class="tw:text-text-2">Порт</span><input v-model.number="edit.port" type="number" class="num tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-72" /></label>
        <label class="tw:flex tw:items-center tw:gap-6"><span class="tw:text-text-2">База</span><input class="tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="edit.database" spellcheck="false" /></label>
        <label class="tw:flex tw:items-center tw:gap-6"><span class="tw:text-text-2">Пользователь</span><input class="tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="edit.user" spellcheck="false" /></label>
        <label class="tw:flex tw:items-center tw:gap-6"
          ><span class="tw:text-text-2">Пароль</span><input class="tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" :value="edit.password ?? ''" type="password" :placeholder="edit.hasPassword ? 'сохранён (оставьте пустым — не менять)' : ''" autocomplete="new-password" @input="edit.password = ($event.target as HTMLInputElement).value || undefined"
        /></label>
        <label class="tw:flex tw:items-center tw:gap-6"
          ><span class="tw:text-text-2">TLS</span
          ><select class="tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="edit.ssl">
            <option v-for="m in SSL_MODES" :key="m.id" :value="m.id">{{ m.title }}</option>
          </select></label
        >
      </template>
      <label class="tw:flex tw:items-center tw:gap-6" title="Сколько запрос может идти на сервере — потом сервер его снимает"><span class="tw:text-text-2">Время запроса, с</span><input v-model.number="edit.timeoutSec" type="number" min="1" class="num tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-72" /></label>
      <label class="tw:flex tw:items-center tw:gap-6" title="Сколько ждать чужую блокировку (другой сеанс держит таблицу или строки). Потом запрос снимается — наш запрос не встаёт в очередь и не задерживает других"><span class="tw:text-text-2">Ждать блокировку, с</span><input v-model.number="edit.lockSec" type="number" min="1" class="num tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-72" /></label>
      <label class="tw:flex tw:items-center tw:gap-6" title="Больше строк не читается — остальные не забираются с сервера"><span class="tw:text-text-2">Строк не больше</span><input v-model.number="edit.maxRows" type="number" min="1" class="num tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-72" /></label>
      <label class="chk tw:flex tw:items-center tw:gap-6"><input class="tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:h-auto" v-model="edit.prod" type="checkbox" />прод (метка — запросы и так только на чтение)</label>
      <p class="note muted tw:text-muted tw:flex-[1_1_100%] tw:m-0 tw:text-[11.5px] tw:whitespace-normal">Надёжнее всего — отдельный пользователь базы только с правом SELECT. Здесь запросы и так идут в транзакции только на чтение, с откатом, без блокирующих чтений; соединение закрывается после каждого запроса.</p>
      <div class="acts tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap tw:flex-[1_1_100%] tw:flex-wrap">
        <button class="pill main tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:[&&]:border-accent tw:text-accent tw:hover:enabled:bg-hover" @click="save()">{{ isNew ? 'Добавить' : 'Сохранить' }}</button>
        <button class="pill tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:hover:border-accent tw:hover:text-text tw:hover:enabled:bg-hover" :disabled="busy" @click="check()"><Icon name="refresh" :size="12" />{{ busy ? 'проверяю…' : 'Проверить подключение' }}</button>
        <span class="tw:[&.ok]:not-[&.bad]:text-up-fg tw:[&.bad]:text-down-fg tw:[&.bad]:whitespace-normal" v-if="test" :class="test.ok ? 'ok' : 'bad'">{{ test.text }}</span>
        <span v-if="err" class="bad tw:text-down-fg tw:whitespace-normal">{{ err }}</span>
      </div>
    </div>
  </div>
</template>
