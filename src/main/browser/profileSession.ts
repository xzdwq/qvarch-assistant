import { app, session, type Session } from 'electron'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { BrowserEmit } from '../../shared/browser'
import { BROWSER_PARTITION } from '../../shared/browser/constants'
import { permissionAllowed } from '../../shared/browser/permissions'
import { SOURCE_SCHEME } from '../viewSource'

/** The browser's profile (its cookies, sign-ins, storage): the section's tabs, the notes' browsers, a run «as the person». */
export function browserSession(): Session {
  return session.fromPartition(BROWSER_PARTITION)
}

/** The app's own pages in the browser (the source viewer) — not a site. */
const isOwnPage = (url: string) => url.startsWith(`${SOURCE_SCHEME}:`)

/** A page's permission asked: by the rule table (shared/browser/permissions.ts) and the browser's setting as it is now. */
export function guardPermissions(ses: Session, sitesAllowed: () => boolean): void {
  ses.setPermissionRequestHandler((_wc, perm, cb, details) => cb(permissionAllowed(perm, isOwnPage(details.requestingUrl ?? ''), sitesAllowed())))
}

/** Downloads go to the system's Downloads folder (a name taken — numbered), their progress told to the window. */
export function keepDownloads(ses: Session, emit: BrowserEmit): void {
  ses.on('will-download', (_e, item) => {
    const dir = app.getPath('downloads')
    const name = item.getFilename() || 'download'
    let path = join(dir, name)
    for (let n = 1; existsSync(path); n++) path = join(dir, `${basename(name, extname(name))} (${n})${extname(name)}`)
    item.setSavePath(path)
    emit('download', { name: basename(path), path, state: 'progress' })
    item.once('done', (_ev, state) => emit('download', { name: basename(path), path, state }))
  })
}
