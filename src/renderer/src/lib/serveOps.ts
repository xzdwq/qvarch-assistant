/** An operation another process asks this window for: its arguments in, a promise of the answer out. */
export type ServedOp = (args: Record<string, unknown>) => Promise<unknown>

/**
 * The handler of asks coming from another process: the op is looked up in `ops` and its answer (or why it failed —
 * an unknown op, a thrown error) goes back by `reply(id, ok, value | message)`.
 */
export function serveOps(ops: Readonly<Record<string, ServedOp>>, reply: (id: string, ok: boolean, value: unknown) => void) {
  return (id: string, op: string, args: Record<string, unknown> | undefined): void => {
    const fn = Object.hasOwn(ops, op) ? ops[op] : undefined
    if (!fn) return reply(id, false, `Неизвестная операция ${op}`)
    fn(args ?? {}).then(
      (v) => reply(id, true, v),
      (e: unknown) => reply(id, false, e instanceof Error ? e.message : String(e)),
    )
  }
}
