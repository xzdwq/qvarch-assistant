import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

/**
 * A notebook shell block's script run on this PC, in a process of its own (an Electron utility process, one per run):
 * the shell started with its script (the values in its environment, never in its text), its id told at once (main
 * kills its tree however the run ends), its output sent on as it comes (UTF-8, a letter split between chunks kept for
 * its rest), its exit code at the end. «Стоп»: the shell and everything it started killed as a tree.
 */
interface Job {
  file: string
  args: string[]
  stdin?: string
  /** A script file (cmd, PowerShell, bash): written in this process's own temp folder, its path the last argument. */
  tempFile?: { name: string; text: string; posixPath?: boolean }
  cwd?: string
  env: Record<string, string>
}
type Out = { type: 'pid'; pid: number } | { type: 'out'; stream: 'out' | 'err'; chunk: string } | { type: 'end'; exitCode: number } | { type: 'error'; message: string }

/** After the shell exits, its streams are read this long more (a grandchild holding them must not hold the run). */
const DRAIN_MS = 300

const port = process.parentPort
const send = (m: Out) => port.postMessage(m)
let child: ChildProcess | undefined

/** The shell and all it started killed (taskkill /T: a child's children too — npm run dev, ping -t). */
function killTree(): Promise<void> {
  const pid = child?.pid
  if (!pid) return Promise.resolve()
  return new Promise((done) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => done()))
}

port.on('message', (e: { data: Job | { type: 'stop' } }) => {
  const m = e.data
  if ('type' in m) {
    if (m.type === 'stop') void killTree().then(() => process.exit(0))
    return
  }
  try {
    const args = [...m.args]
    if (m.tempFile) {
      const file = join(tmpdir(), m.tempFile.name)
      writeFileSync(file, m.tempFile.text, 'utf8')
      args.push(m.tempFile.posixPath ? file.replace(/\\/g, '/') : file)
    }
    child = spawn(m.file, args, { cwd: m.cwd || undefined, env: m.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    if (child.pid) send({ type: 'pid', pid: child.pid })
    const decoders = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') }
    child.stdout?.on('data', (b: Buffer) => send({ type: 'out', stream: 'out', chunk: decoders.out.write(b) }))
    child.stderr?.on('data', (b: Buffer) => send({ type: 'out', stream: 'err', chunk: decoders.err.write(b) }))
    child.on('error', (err) => send({ type: 'error', message: `Не удалось запустить ${m.file}: ${err.message}` }))
    let ended = false
    const end = (code: number | null) => {
      if (ended) return
      ended = true
      const tail = { out: decoders.out.end(), err: decoders.err.end() }
      if (tail.out) send({ type: 'out', stream: 'out', chunk: tail.out })
      if (tail.err) send({ type: 'out', stream: 'err', chunk: tail.err })
      send({ type: 'end', exitCode: code ?? -1 })
    }
    child.on('close', (code) => end(code))
    // the shell exited but something it started still holds its output: the run ends a moment later anyway
    child.on('exit', (code) =>
      setTimeout(() => {
        child?.stdout?.destroy()
        child?.stderr?.destroy()
        end(code)
      }, DRAIN_MS),
    )
    child.stdin?.end(m.stdin ?? '')
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
})
