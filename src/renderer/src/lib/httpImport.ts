import type { HttpFolder, HttpKV, HttpNode } from '@shared/http'

/**
 * Requests brought into the HTTP section (a recorded chain, the API map's calls, a Swagger's operations): the section
 * open (it keeps its collection itself and saves it) — taken in by it, else written to its file. Without this the open
 * section would save its own copy over what was written and the requests would be lost.
 */
type Taker = (folder: HttpFolder | undefined, vars: Array<HttpKV & { secret?: boolean }>) => Promise<void>
let taker: Taker | undefined

/** The open HTTP section takes the imports while it lives (the returned function lets go). */
export function takeHttpImports(fn: Taker): () => void {
  taker = fn
  return () => {
    if (taker === fn) taker = undefined
  }
}

const firstRequest = (n: HttpNode): string | undefined => (n.type === 'request' ? n.id : n.children.map(firstRequest).find(Boolean))
/** The folder's first request (to show), else the folder. */
export const firstRequestOf = (f: HttpFolder): string => firstRequest(f) ?? f.id

/** Requests (and variables) into the HTTP section, wherever it is now. */
export async function importToHttp(folder: HttpFolder | undefined, vars: Array<HttpKV & { secret?: boolean }>): Promise<void> {
  const f = folder && (JSON.parse(JSON.stringify(folder)) as HttpFolder)
  const v = JSON.parse(JSON.stringify(vars)) as typeof vars
  if (taker) return taker(f, v)
  if (f) await window.qa.httpImport(f, v)
}
