/**
 * An error as a person reads it: its kind (a plain Error — none), its message, the line of the code it came from.
 * (Thrown inside the vm it is that context's Error — `instanceof Error` is false there, so it is told by its shape.)
 */
export function errorText(err: unknown, file: string): string {
  const e = err as { name?: unknown; message?: unknown; stack?: unknown } | null
  if (!e || typeof e !== 'object' || typeof e.message !== 'string') return String(err)
  const name = typeof e.name === 'string' ? e.name : 'Error'
  const msg = `${name === 'Error' || name === 'PassError' ? '' : `${name}: `}${e.message}`
  const at = name !== 'PassError' && typeof e.stack === 'string' ? new RegExp(`${file}:(\\d+)`).exec(e.stack)?.[1] : undefined
  return at ? `${msg} (строка ${at})` : msg
}
