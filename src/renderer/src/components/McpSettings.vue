<script setup lang="ts">
import { computed, ref } from 'vue'
import type { McpInfoView } from '@shared/api'
import Icon from './Icon.vue'

/**
 * Settings → AI-ассистенты: Qvarch as an MCP server — on / off, its address and token, the hosts tests may run
 * against without asking, and the clients set up (Claude Code — VS Code and the terminal; Claude Desktop).
 */
const info = ref<McpInfoView>()
const msg = ref('')
const err = ref('')
const showToken = ref(false)
const allowText = ref('')
async function load(): Promise<void> {
  info.value = await window.qa.mcpInfo()
  allowText.value = info.value.allow.join(', ')
}
void load()
async function set(p: Parameters<typeof window.qa.mcpSet>[0]): Promise<void> {
  err.value = ''
  info.value = await window.qa.mcpSet(p)
  allowText.value = info.value.allow.join(', ')
}
const saveAllow = () => set({ allow: allowText.value.split(/[,\s]+/).filter(Boolean) })
const codeCmd = computed(() => (info.value ? `claude mcp add --transport http --scope user qvarch ${info.value.url} --header "Authorization: Bearer ${info.value.token}"` : ''))
const desktopJson = computed(() =>
  info.value ? JSON.stringify({ mcpServers: { qvarch: { command: info.value.exe, args: [info.value.bridge], env: { ELECTRON_RUN_AS_NODE: '1' } } } }, null, 2) : '',
)
async function install(c: 'desktop' | 'code'): Promise<void> {
  msg.value = ''
  err.value = ''
  try {
    msg.value = await window.qa.mcpInstall(c)
  } catch (e) {
    err.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
  }
}
async function copy(t: string, what: string): Promise<void> {
  await navigator.clipboard.writeText(t)
  msg.value = `${what} скопирован`
}
</script>

<template>
  <div v-if="info" class="mcp">
    <div class="olopts">
      <label class="switch"><input type="checkbox" :checked="info.on" @change="set({ on: ($event.target as HTMLInputElement).checked })" /><span>Разрешить AI-ассистентам работать с Qvarch</span></label>
    </div>
    <p class="muted small">
      Qvarch становится MCP-сервером: ассистент (Claude Code в VS Code и терминале, Claude Desktop) может создавать папки задач и заметки, писать и запускать HTTP-запросы, код и тесты Playwright, читать отчёты, смотреть задачи Jira и вести учёт времени в «Моей работе». Чтение и запуск — всегда; заметки и время — без вопросов (время только создаётся и продлевается, никогда не удаляется и не переносится); тесты против стендов не из списка ниже — с вашим подтверждением.
    </p>
    <p class="st" :class="{ ok: info.listening, bad: info.on && !info.listening }">
      <i></i>{{ !info.on ? 'Выключено' : info.listening ? `Работает: ${info.url}` : 'Не запустился' }}<span v-if="info.error" class="muted"> · {{ info.error }}</span>
    </p>

    <h3 class="mt">Подключить</h3>
    <div class="cl">
      <div class="ci">
        <b>Claude Code</b><span class="muted">VS Code и терминал — одна настройка</span>
        <span class="grow"></span>
        <button @click="install('code')"><Icon name="plus" :size="12" />Подключить</button>
      </div>
      <div class="cmd"><code>{{ codeCmd }}</code><button title="Скопировать команду" @click="copy(codeCmd, 'Команда')"><Icon name="copy" :size="12" /></button></div>
      <div class="ci">
        <b>Claude Desktop</b><span class="muted">через мост (stdio) — exe самого Qvarch</span>
        <span class="grow"></span>
        <button @click="install('desktop')"><Icon name="plus" :size="12" />Подключить</button>
      </div>
      <details class="muted small">
        <summary>Настройка вручную (claude_desktop_config.json)</summary>
        <div class="cmd"><code class="pre">{{ desktopJson }}</code><button title="Скопировать" @click="copy(desktopJson, 'Фрагмент')"><Icon name="copy" :size="12" /></button></div>
      </details>
      <p v-if="msg" class="okm">{{ msg }}</p>
      <p v-if="err" class="errm">{{ err }}</p>
    </div>

    <h3 class="mt">Стенды без подтверждения</h3>
    <div class="grid">
      <label class="span2">
        Адреса через запятую (* — любое)
        <input v-model="allowText" spellcheck="false" @change="saveAllow" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" />
      </label>
    </div>
    <p class="muted small">Тест или запрос к другому адресу ассистент запустит только после вашего «Разрешить» (на этот сеанс приложения).</p>

    <h3 class="mt">Доступ</h3>
    <div class="grid">
      <label>
        Порт
        <input type="number" :value="info.port" min="1024" max="65535" @change="set({ port: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <label>
        Токен
        <span class="tok">
          <code>{{ showToken ? info.token : '•'.repeat(24) }}</code>
          <button :title="showToken ? 'Скрыть' : 'Показать'" @click="showToken = !showToken"><Icon :name="showToken ? 'eyeOff' : 'eye'" :size="12" /></button>
          <button title="Скопировать" @click="copy(info.token, 'Токен')"><Icon name="copy" :size="12" /></button>
          <button title="Новый токен (подключённые клиенты нужно будет подключить заново)" @click="set({ newToken: true })"><Icon name="refresh" :size="12" /></button>
        </span>
      </label>
    </div>
    <p class="muted small">Сервер слушает только этот компьютер (127.0.0.1) и пускает только с токеном; страницы сайтов к нему не обратятся.</p>
  </div>
</template>

<style scoped>
.st {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 6px 0;
  font-size: 13px;
}
.st i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
}
.st.ok i {
  background: #4ade80;
}
.st.bad i {
  background: #f87171;
}
.cl {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ci {
  display: flex;
  align-items: center;
  gap: 10px;
}
.grow {
  flex: 1;
}
.ci button,
.cmd button,
.tok button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
}
.cmd {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.cmd code {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  font-family: var(--font-data);
  font-size: 11.5px;
  word-break: break-all;
}
.cmd code.pre {
  white-space: pre;
  overflow: auto;
  word-break: normal;
}
.tok {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tok code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-data);
  font-size: 12px;
  text-overflow: ellipsis;
}
.tok button {
  padding: 0 7px;
}
.okm {
  margin: 0;
  color: #4ade80;
  font-size: 12.5px;
}
.errm {
  margin: 0;
  color: var(--down-fg);
  font-size: 12.5px;
}
</style>
