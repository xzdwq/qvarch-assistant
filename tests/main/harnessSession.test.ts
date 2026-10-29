import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { harnessTurn, type RemoteTool } from '../../src/main/agent/sessions/harnessSession'

let server: Server | undefined
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())))

/** A harness answering with `answer` (each piece written apart), what it was asked kept. */
async function harness(status: number, type: string, pieces: string[]): Promise<{ base: string; asked: { headers?: IncomingHttpHeaders; body?: string } }> {
  const asked: { headers?: IncomingHttpHeaders; body?: string } = {}
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      asked.headers = req.headers
      asked.body = body
      res.writeHead(status, { 'Content-Type': type })
      for (const p of pieces) {
        res.write(p)
        await new Promise((r) => setTimeout(r, 2))
      }
      res.end()
    })
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  return { base: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1`, asked }
}
const turn = (base: string, tools: RemoteTool[], extra: Partial<Parameters<typeof harnessTurn>[0]> = {}) =>
  harnessTurn({ baseUrl: base, key: 'k', headers: { 'X-Profile': 'p' }, system: 'S', prompt: 'P', sessionHeader: 'X-Session', sessionId: 'qvarch-r-p', toolEvent: 'h.tool', signal: new AbortController().signal, onTool: (t) => tools.push(t), ...extra })

describe('harnessTurn', () => {
  it('streams the answer, its tools paired, asked with the session and headers', async () => {
    const chunk = (s: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`
    const { base, asked } = await harness(200, 'text/event-stream', [
      ': keepalive\n\n',
      chunk('При'),
      'event: h.tool\ndata: {"tool":"terminal","status":"started","args":"ls"}\n\n',
      'event: h.tool\ndata: {"tool":"terminal","status":"completed","preview":"a"}\n\n',
      chunk('вет'),
      'data: [DONE]\n\n',
    ])
    const tools: RemoteTool[] = []
    expect(await turn(base, tools)).toEqual({ text: 'Привет' })
    expect(tools).toMatchObject([{ name: 'terminal', args: 'ls', result: 'a' }])
    expect(asked.headers?.authorization).toBe('Bearer k')
    expect(asked.headers?.['x-session']).toBe('qvarch-r-p')
    expect(asked.headers?.['x-profile']).toBe('p')
    expect(JSON.parse(asked.body!)).toMatchObject({ stream: true, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'P' }] })
  })
  it('the same tool run twice at once — paired by its call id', async () => {
    const tool = (id: string, status: string, label?: string) => `event: h.tool\ndata: ${JSON.stringify({ tool: 'terminal', toolCallId: id, status, ...(label ? { label } : {}) })}\n\n`
    const { base } = await harness(200, 'text/event-stream', [tool('a', 'running', 'ls a'), tool('b', 'running', 'ls b'), tool('b', 'completed'), tool('a', 'completed'), 'data: [DONE]\n\n'])
    const tools: RemoteTool[] = []
    await turn(base, tools)
    expect(tools.map((t) => t.args)).toEqual(['ls b', 'ls a'])
  })
  it('a tool begun and never ended is kept', async () => {
    const { base } = await harness(200, 'text/event-stream', ['event: tool.started\ndata: {"tool":"web"}\n\n'])
    const tools: RemoteTool[] = []
    expect(await turn(base, tools)).toEqual({ text: '' })
    expect(tools).toMatchObject([{ name: 'web' }])
  })
  it('reads a whole JSON answer', async () => {
    const { base } = await harness(200, 'application/json', ['{"choices":[{"message":{"content":" ок "}}]}'])
    expect(await turn(base, [])).toEqual({ text: 'ок' })
  })
  it('says its status and its stream error', async () => {
    const busy = await harness(429, 'application/json', ['{"error":"busy"}'])
    await expect(turn(busy.base, [])).rejects.toThrow('Агент ответил 429')
    server!.close()
    const broke = await harness(200, 'text/event-stream', ['data: {"error":{"message":"boom"}}\n\n'])
    await expect(turn(broke.base, [])).rejects.toThrow('Агент: boom')
  })
  it('no server — said so', async () => {
    await expect(turn('http://127.0.0.1:1/v1', [])).rejects.toThrow('Нет связи с агентом')
  })
})
