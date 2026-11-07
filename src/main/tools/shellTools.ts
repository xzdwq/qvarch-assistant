import type { McpTool } from '../mcp'
import type { ToolCtx } from '../mcpTools'

/**
 * What an AI is told of working on servers: the rule (the person's servers — only reading until they allow more in the
 * conversation) is repeated in the tool's answer, not only in the guide — it is what the AI reads right before acting.
 */
export const SSH_RULES = [
  'Правила работы с серверами (SSH):',
  '- Без явного разрешения пользователя в этом разговоре — только команды чтения и проверки: df -h, free -m, uptime, ls, cat, tail, grep, ps, systemctl status, journalctl, docker ps, docker logs.',
  '- Любое изменение на сервере (rm, mv, правка файлов, перезапуск служб, docker prune / rm, установка пакетов, sudo) — сначала спроси пользователя и опиши, что именно и зачем; выполняй только после его «да».',
  '- Скрипт, который ты пишешь в блок оболочки, пользователь всё равно подтверждает в приложении перед запуском — объясни ему в ответе, что скрипт делает.',
  '- Пароли сессий тебе не доступны и не нужны: блок подключается сам.',
].join('\n')

/** The servers the person keeps sessions for (no passwords ever), with the rules of working on them. */
export function shellTools(c: ToolCtx): McpTool[] {
  return [
    {
      name: 'ssh_sessions',
      access: 'read',
      description: 'Сохранённые сессии SSH пользователя (имя, user@host, папка, id — без паролей). id нужен блоку оболочки: ```bash run ssh=<id> name=… — команды на этом сервере. Перед работой с сервером прочитай правила в ответе.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const list = c.sshSessions()
        const rows = list.length ? list.map((s) => `- ${s.name} — ${s.user}@${s.host}${s.port === 22 ? '' : `:${s.port}`}${s.folder ? ` (папка ${s.folder})` : ''} · id: ${s.id}`).join('\n') : 'Сессий нет — пользователь добавляет их в разделе «Терминал» → «Сессии».'
        return `${rows}\n\n${SSH_RULES}`
      },
    },
  ]
}
