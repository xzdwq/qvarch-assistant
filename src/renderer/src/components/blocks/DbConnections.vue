<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DB_DEFAULTS, DB_KINDS, type DbConn, type DbKind } from '@shared/sql'
import { connWhere, dbConns, kindTitle, loadConns } from '../../lib/sqlDb'
import Icon from '../Icon.vue'

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
    err.value = (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
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
  <div class="dbc">
    <div class="dbc-head">
      <b>Базы данных</b>
      <span class="muted">только чтение · отдельное соединение на каждый запрос</span>
      <span class="grow"></span>
      <button class="pill" @click="open()"><Icon name="plus" :size="12" />подключение</button>
    </div>
    <div v-for="c in dbConns" :key="c.id" class="dbc-row" :class="{ on: edit?.id === c.id, cur: c.name === props.current }">
      <button class="nm" :title="`В заметке: db=${c.name}`" @click="open(c)">
        <b>{{ c.name }}</b><span class="muted">{{ kindTitle(c.kind) }} · {{ connWhere(c) }}</span><span v-if="c.prod" class="prod">прод</span>
      </button>
      <button v-if="c.name !== props.current" class="pill" title="Этот блок — через это подключение" @click="emit('pick', c.name)">выбрать</button>
      <button class="ib" title="Удалить" @click="remove(c)"><Icon name="x" :size="12" /></button>
    </div>

    <div v-if="edit" class="dbc-form">
      <label><span>Имя</span><input v-model="edit.name" placeholder="app-dev (в заметке: db=app-dev)" spellcheck="false" /></label>
      <label
        ><span>СУБД</span
        ><select :value="edit.kind" @change="setKind(($event.target as HTMLSelectElement).value as DbKind)">
          <option v-for="k in DB_KINDS" :key="k.id" :value="k.id">{{ k.title }}</option>
        </select></label
      >
      <template v-if="edit.kind === 'sqlite'">
        <label class="wide"><span>Файл</span><input v-model="edit.file" placeholder="C:\путь\к\базе.sqlite" spellcheck="false" /></label>
      </template>
      <template v-else>
        <label><span>Хост</span><input v-model="edit.host" spellcheck="false" /></label>
        <label><span>Порт</span><input v-model.number="edit.port" type="number" class="num" /></label>
        <label><span>База</span><input v-model="edit.database" spellcheck="false" /></label>
        <label><span>Пользователь</span><input v-model="edit.user" spellcheck="false" /></label>
        <label
          ><span>Пароль</span><input :value="edit.password ?? ''" type="password" :placeholder="edit.hasPassword ? 'сохранён (оставьте пустым — не менять)' : ''" autocomplete="new-password" @input="edit.password = ($event.target as HTMLInputElement).value || undefined"
        /></label>
        <label
          ><span>TLS</span
          ><select v-model="edit.ssl">
            <option value="off">без TLS</option>
            <option value="verify">TLS, проверять сертификат</option>
            <option value="no-verify">TLS, без проверки сертификата</option>
          </select></label
        >
      </template>
      <label title="Сколько запрос может идти на сервере — потом сервер его снимает"><span>Время запроса, с</span><input v-model.number="edit.timeoutSec" type="number" min="1" class="num" /></label>
      <label title="Сколько ждать чужую блокировку (другой сеанс держит таблицу или строки). Потом запрос снимается — наш запрос не встаёт в очередь и не задерживает других"><span>Ждать блокировку, с</span><input v-model.number="edit.lockSec" type="number" min="1" class="num" /></label>
      <label title="Больше строк не читается — остальные не забираются с сервера"><span>Строк не больше</span><input v-model.number="edit.maxRows" type="number" min="1" class="num" /></label>
      <label class="chk"><input v-model="edit.prod" type="checkbox" />прод (метка — запросы и так только на чтение)</label>
      <p class="note muted">Надёжнее всего — отдельный пользователь базы только с правом SELECT. Здесь запросы и так идут в транзакции только на чтение, с откатом, без блокирующих чтений; соединение закрывается после каждого запроса.</p>
      <div class="acts">
        <button class="pill main" @click="save()">{{ isNew ? 'Добавить' : 'Сохранить' }}</button>
        <button class="pill" :disabled="busy" @click="check()"><Icon name="refresh" :size="12" />{{ busy ? 'проверяю…' : 'Проверить подключение' }}</button>
        <span v-if="test" :class="test.ok ? 'ok' : 'bad'">{{ test.text }}</span>
        <span v-if="err" class="bad">{{ err }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dbc {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
  font-size: 12.5px;
}
.dbc-head,
.dbc-row,
.acts {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
}
.grow {
  flex: 1;
}
.muted {
  color: var(--muted);
}
.dbc-row {
  border-top: 1px solid var(--border);
  padding-top: 4px;
}
.dbc-row.on .nm b {
  color: var(--accent);
}
.nm {
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 2px 0;
  overflow: hidden;
  border: 0;
  background: none;
  color: var(--text);
  text-align: left;
  text-overflow: ellipsis;
}
.nm .muted {
  overflow: hidden;
  text-overflow: ellipsis;
}
.cur .nm b::after {
  content: ' ·  в этом блоке';
  color: var(--muted);
  font-weight: 400;
}
.prod {
  flex: none;
  padding: 0 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--warn-fg) 18%, transparent);
  color: var(--warn-fg);
  font-size: 11px;
}
.dbc-form {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
.dbc-form label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dbc-form label.wide {
  flex: 1 1 100%;
}
.dbc-form label > span {
  color: var(--text-2);
}
.dbc-form input,
.dbc-form select {
  height: 26px;
  min-width: 0;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
}
.dbc-form label.wide input {
  flex: 1;
}
.num {
  width: 72px;
}
.chk input {
  height: auto;
}
.note {
  flex: 1 1 100%;
  margin: 0;
  font-size: 11.5px;
  white-space: normal;
}
.acts {
  flex: 1 1 100%;
  flex-wrap: wrap;
}
.pill {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  background: transparent;
  color: var(--text-2);
}
.pill:hover {
  border-color: var(--accent);
  color: var(--text);
}
.pill.main {
  border-color: var(--accent);
  color: var(--accent);
}
.ok {
  color: var(--up-fg);
}
.bad {
  color: var(--down-fg);
  white-space: normal;
}
.ib {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
}
.ib:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
