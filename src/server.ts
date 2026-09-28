// ── HTTP + SSE ──────────────────────────────────────────────────────────────
// node:http rather than a framework — six routes do not need one, and §24 asks
// for the fewest moving parts. See docs/decisions/0008-node-http.md.
//
// §11/§20: provider keys live here and are never sent to the browser.

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { InMemoryStore } from './store/InMemoryStore.ts'
import { ConversationEngine, type EngineEvent } from './engine/engine.ts'
import { MockProvider } from './providers/mock.ts'
import type { AIProvider, Mode } from './types.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 3000)
const MOCK = process.argv.includes('--mock')

const store = new InMemoryStore()

// One subscriber list per conversation. Events are fanned out to every open
// SSE connection for that conversation.
const subscribers = new Map<string, Set<(e: EngineEvent) => void>>()
function publish(conversationId: string, e: EngineEvent) {
  for (const fn of subscribers.get(conversationId) ?? []) fn(e)
}

async function buildProviders(): Promise<AIProvider[]> {
  if (MOCK) {
    return [
      new MockProvider('openai',    { reply: (_c, t) => `ChatGPT (mock) turn ${t}: I would start with PostgreSQL.`, delayMs: 40 }),
      new MockProvider('anthropic', { reply: (_c, t) => `Claude (mock) turn ${t}: agreed on Postgres, but the write pattern matters more than the engine.`, delayMs: 40 }),
    ]
  }
  const out: AIProvider[] = []
  // Only construct an adapter when its key exists, so the app runs with one
  // provider configured (§16: one being unavailable is not fatal).
  if (process.env.OPENAI_API_KEY) {
    const { OpenAIProvider } = await import('./providers/openai.ts')
    out.push(new OpenAIProvider())
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const { AnthropicProvider } = await import('./providers/anthropic.ts')
    out.push(new AnthropicProvider())
  }
  if (out.length === 0) {
    console.error('No provider keys found. Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY, or run with --mock.')
    process.exit(1)
  }
  return out
}

const providers = await buildProviders()

const engine = new ConversationEngine({
  store, providers,
  onEvent: e => {
    const cid = e.type === 'round-end' ? currentConversation : messageConv(e)
    if (cid) publish(cid, e)
  },
})

// The engine's events carry a message; round-end does not, so the active
// conversation is tracked alongside. Single-room v0.1 — see the README.
let currentConversation: string | null = null
function messageConv(e: EngineEvent): string | null {
  if (e.type === 'message-start' || e.type === 'message-end') return e.message.conversationId
  return currentConversation
}

const json = (res: any, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: any): Promise<any> {
  const chunks: Buffer[] = []
  for await (const c of req) {
    chunks.push(c)
    // §20: a request body has no business being large here.
    if (chunks.reduce((n, b) => n + b.length, 0) > 64_000) throw new Error('body too large')
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
}

const VALID_MODES: Mode[] = ['both', 'openai', 'anthropic', 'roundtable']

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const path = url.pathname

  try {
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      const html = await readFile(join(HERE, '..', 'web', 'index.html'))
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(html)
    }

    if (req.method === 'POST' && path === '/api/conversations') {
      const c = await store.createConversation()
      currentConversation = c.id
      return json(res, 201, { conversation: c, providers: providers.map(p => ({ id: p.id, name: p.name })) })
    }

    // SSE. Last-Event-ID carries the last `seq` the client saw; anything newer
    // is replayed before live events resume (ADR 0001 + 0003).
    const sse = path.match(/^\/api\/conversations\/([^/]+)\/events$/)
    if (req.method === 'GET' && sse) {
      const cid = sse[1]
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write(': connected\n\n')

      const since = Number(req.headers['last-event-id'] ?? 0)
      if (since > 0) {
        for (const m of await store.getMessages(cid)) {
          if (m.seq > since) res.write(`id: ${m.seq}\ndata: ${JSON.stringify({ type: 'message-end', message: m })}\n\n`)
        }
      }

      const send = (e: EngineEvent) => {
        const id = (e.type === 'message-end') ? `id: ${e.message.seq}\n` : ''
        res.write(`${id}data: ${JSON.stringify(e)}\n\n`)
      }
      if (!subscribers.has(cid)) subscribers.set(cid, new Set())
      subscribers.get(cid)!.add(send)

      const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
      req.on('close', () => { clearInterval(ping); subscribers.get(cid)?.delete(send) })
      return
    }

    const post = path.match(/^\/api\/conversations\/([^/]+)\/messages$/)
    if (req.method === 'POST' && post) {
      const cid = post[1]
      const body = await readBody(req)
      const content = String(body.content ?? '').trim()
      const mode = VALID_MODES.includes(body.mode) ? (body.mode as Mode) : 'both'
      if (!content) return json(res, 400, { error: 'content required' })
      if (content.length > 20_000) return json(res, 400, { error: 'content too long' })
      currentConversation = cid
      // Answer immediately; everything else arrives over SSE.
      json(res, 202, { accepted: true })
      engine.send(cid, content, mode).catch(err => console.error('[engine]', err))
      return
    }

    const cancel = path.match(/^\/api\/conversations\/([^/]+)\/cancel$/)
    if (req.method === 'POST' && cancel) {
      engine.cancel(cancel[1])
      return json(res, 200, { cancelled: true })
    }

    const msgs = path.match(/^\/api\/conversations\/([^/]+)\/messages$/)
    if (req.method === 'GET' && msgs) {
      return json(res, 200, { messages: await store.getMessages(msgs[1]) })
    }

    json(res, 404, { error: 'not found' })
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? 'server error' })
  }
})

server.listen(PORT, () => {
  console.log(`AI Room on http://localhost:${PORT}${MOCK ? '  (mock providers)' : ''}`)
  console.log(`participants: ${providers.map(p => p.name).join(', ')}`)
})
