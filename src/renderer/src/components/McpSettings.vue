<script setup lang="ts">
import { computed, ref } from 'vue'
import { remoteError } from '../../../shared/remoteError'
import type { McpClient, McpInfoView } from '@shared/api'
import Icon from './Icon.vue'

/**
 * Settings → ИИ-агенты: Qvarch as an MCP server — on / off, its address and token, and the clients set up
 * (Claude Code — VS Code and the terminal; Claude Desktop).
 */
const info = ref<McpInfoView>()
const msg = ref('')
const err = ref('')
const showToken = ref(false)
async function load(): Promise<void> {
  info.value = await window.qa.mcpInfo()
}
void load()
async function set(p: Parameters<typeof window.qa.mcpSet>[0]): Promise<void> {
  err.value = ''
  info.value = await window.qa.mcpSet(p)
}
const codeCmd = computed(() => (info.value ? `claude mcp add --transport http --scope user qvarch ${info.value.url} --header "Authorization: Bearer ${info.value.token}"` : ''))
const desktopJson = computed(() =>
  info.value ? JSON.stringify({ mcpServers: { qvarch: { command: info.value.exe, args: [info.value.bridge], env: { ELECTRON_RUN_AS_NODE: '1' } } } }, null, 2) : '',
)
async function install(c: McpClient): Promise<void> {
  msg.value = ''
  err.value = ''
  try {
    msg.value = await window.qa.mcpInstall(c)
  } catch (e) {
    err.value = remoteError(e)
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
    <p class="st tw:group/st tw:flex tw:items-center tw:gap-7 tw:my-6 tw:mx-0 tw:text-[13px]" :class="{ ok: info.listening, bad: info.on && !info.listening }">
      <i class="tw:w-8 tw:h-8 tw:rounded-[50%] tw:bg-muted tw:group-[.ok]/st:not-group-[.bad]/st:bg-[var(--mcp-ok)] tw:group-[.bad]/st:bg-[var(--mcp-bad)]"></i>{{ !info.on ? 'Выключено' : info.listening ? `Работает: ${info.url}` : 'Не запустился' }}<span v-if="info.error" class="muted"> · {{ info.error }}</span>
    </p>

    <h3 class="mt">Подключить</h3>
    <div class="cl tw:flex tw:flex-col tw:gap-8">
      <div class="ci tw:flex tw:items-center tw:gap-10">
        <b>Claude Code</b><span class="muted">VS Code и терминал — одна настройка</span>
        <span class="grow tw:flex-1"></span>
        <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text" @click="install('code')"><Icon name="plus" :size="12" />Подключить</button>
      </div>
      <div class="cmd tw:flex tw:items-start tw:gap-6"><code class="tw:flex-1 tw:min-w-0 tw:py-6 tw:px-8 tw:border tw:border-border tw:rounded-[6px] tw:bg-bg tw:font-data tw:text-[11.5px] tw:break-all">{{ codeCmd }}</code><button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text" title="Скопировать команду" @click="copy(codeCmd, 'Команда')"><Icon name="copy" :size="12" /></button></div>
      <div class="ci tw:flex tw:items-center tw:gap-10">
        <b>Claude Desktop</b><span class="muted">через мост (stdio) — exe самого Qvarch</span>
        <span class="grow tw:flex-1"></span>
        <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text" @click="install('desktop')"><Icon name="plus" :size="12" />Подключить</button>
      </div>
      <details class="muted small">
        <summary>Настройка вручную (claude_desktop_config.json)</summary>
        <div class="cmd tw:flex tw:items-start tw:gap-6"><code class="pre tw:flex-1 tw:min-w-0 tw:py-6 tw:px-8 tw:border tw:border-border tw:rounded-[6px] tw:bg-bg tw:font-data tw:text-[11.5px] tw:whitespace-pre tw:overflow-auto tw:break-normal">{{ desktopJson }}</code><button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text" title="Скопировать" @click="copy(desktopJson, 'Фрагмент')"><Icon name="copy" :size="12" /></button></div>
      </details>
      <p v-if="msg" class="okm tw:m-0 tw:text-[var(--mcp-ok)] tw:text-[12.5px]">{{ msg }}</p>
      <p v-if="err" class="errm tw:m-0 tw:text-down-fg tw:text-[12.5px]">{{ err }}</p>
    </div>

    <h3 class="mt">Доступ</h3>
    <div class="fields">
      <label>
        Порт
        <input type="number" :value="info.port" min="1024" max="65535" @change="set({ port: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <label>
        Токен
        <span class="tok tw:flex tw:items-center tw:gap-4">
          <code class="tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:font-data tw:text-[12px] tw:text-ellipsis">{{ showToken ? info.token : '•'.repeat(24) }}</code>
          <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text tw:py-0 tw:px-7" :title="showToken ? 'Скрыть' : 'Показать'" @click="showToken = !showToken"><Icon :name="showToken ? 'eyeOff' : 'eye'" :size="12" /></button>
          <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text tw:py-0 tw:px-7" title="Скопировать" @click="copy(info.token, 'Токен')"><Icon name="copy" :size="12" /></button>
          <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-panel tw:text-text tw:py-0 tw:px-7" title="Новый токен (подключённые клиенты нужно будет подключить заново)" @click="set({ newToken: true })"><Icon name="refresh" :size="12" /></button>
        </span>
      </label>
    </div>
    <p class="muted small">Сервер слушает только этот компьютер (127.0.0.1) и пускает только с токеном; страницы сайтов к нему не обратятся.</p>
  </div>
</template>
