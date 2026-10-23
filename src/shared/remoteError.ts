/** An error from the main process in plain words (Electron's «Error invoking remote method '…': Error:» prefix dropped). */
export function remoteError(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
