import { shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { signInOutcomePage as outcomePage } from '../signInPage'
import { ATLASSIAN_AUTH, JIRA_CALLBACK_PORT, JIRA_REDIRECT, JIRA_SCOPES } from './jiraAuth'

const SIGN_IN_LIMIT_MS = 5 * 60_000

/**
 * The browser sign-in: the Atlassian consent page opened, a one-off local callback waits for the code (5 minutes at
 * most), checks the state, hands the code over and tells the browser the outcome. One sign-in at a time: a new one
 * ends the one before (its promise rejects).
 */
export class JiraSignIn {
  private current?: { server: Server; timer: NodeJS.Timeout; fail: (e: Error) => void }

  /** A sign-in waiting for the browser. */
  get busy(): boolean {
    return !!this.current
  }

  /** Resolves once `onCode` took the code the browser brought back; rejects on cancel, a bad state, a busy port, the time limit. */
  run(clientId: string, onCode: (code: string) => Promise<void>): Promise<void> {
    this.current?.fail(new Error('Вход начат заново'))
    const state = randomBytes(16).toString('hex')
    return new Promise((resolve, reject) => {
      const finish = (err?: Error) => {
        if (this.current?.server !== server) return
        clearTimeout(this.current.timer)
        server.close()
        this.current = undefined
        if (err) reject(err)
        else resolve()
      }
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', JIRA_REDIRECT)
        if (url.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }
        const page = (title: string, text: string) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(outcomePage(title, text))
        }
        if (url.searchParams.get('state') !== state) {
          page('Не получилось', 'Неверный state — попробуйте войти ещё раз из приложения.')
          return finish(new Error('Неверный state в ответе Atlassian'))
        }
        const code = url.searchParams.get('code')
        if (!code) {
          page('Вход отменён', url.searchParams.get('error_description') ?? 'Atlassian не вернул код.')
          return finish(new Error(url.searchParams.get('error_description') ?? 'Вход отменён'))
        }
        onCode(code)
          .then(() => {
            page('Готово', 'Jira подключена — вкладку можно закрыть.')
            finish()
          })
          .catch((e: Error) => {
            page('Не получилось', e.message)
            finish(e)
          })
      })
      this.current = { server, timer: setTimeout(() => finish(new Error('Вход не завершён за 5 минут')), SIGN_IN_LIMIT_MS), fail: finish }
      server.on('error', (e) => finish(new Error(`Порт ${JIRA_CALLBACK_PORT} занят: ${e.message}`)))
      server.listen(JIRA_CALLBACK_PORT, '127.0.0.1', () => {
        const q = new URLSearchParams({
          audience: 'api.atlassian.com',
          client_id: clientId,
          scope: JIRA_SCOPES,
          redirect_uri: JIRA_REDIRECT,
          state,
          response_type: 'code',
          prompt: 'consent',
        })
        void shell.openExternal(`${ATLASSIAN_AUTH}/authorize?${q}`)
      })
    })
  }

  /** The waiting callback closed (the app quitting). */
  close(): void {
    this.current?.server.close()
  }
}
