import type { AppContext } from '../app/appContext'
import { handle } from './router'

/** Outlook / Teams (meetings → blocks, the Teams status → a call) and Jira (tasks, releases, sign-in, sync). */
export function registerIntegrationsIpc(app: AppContext): void {
  const { outlook, jira } = app
  handle('outlookState', () => outlook.state())
  handle('outlookLogin', () => outlook.login())
  handle('outlookLogout', () => outlook.logout())
  handle('outlookSync', () => outlook.sync())

  handle('jiraState', () => jira.state())
  handle('jiraLogin', () => jira.login())
  handle('jiraLogout', () => jira.logout())
  handle('jiraSync', () => jira.sync())
  handle('jiraSetSecret', (_e, secret) => jira.setSecret(String(secret ?? '')))
  handle('jiraStar', (_e, key, on) => jira.star(key, on))
  handle('jiraSetMyStatus', (_e, key, status) => jira.setMyStatus(key, status))
  handle('jiraFind', (_e, q, offset, limit, mode, query) => jira.find(String(q ?? ''), Number(offset) || 0, Number(limit) || 50, mode === 'pick' ? 'pick' : 'list', query && typeof query === 'object' ? query : undefined))
  handle('jiraIssue', (_e, key) => jira.issue(String(key)))
  handle('jiraVersions', (_e, q, offset, limit) => jira.findVersions(String(q ?? ''), Number(offset) || 0, Number(limit) || 40))
  handle('jiraVersionIssues', (_e, id) => jira.versionIssues(String(id)))
}
