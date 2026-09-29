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

// ── The event log ───────────────────────────────────────────────────────────
// The SSE cursor addresses EVENTS, not messages. An earlier version used a
// message's `seq` as the id, which meant only message-end carried one: a client
// that disconnected mid-generation resumed having missed the message-start and
// every delta, and replay re-sent still-streaming messages labelled
// message-end — telling the browser a turn had finished while it was still
// being written. See ADR 0009.
let eventSeq = 0
const eventLog = new Map<string, { id: number; e: EngineEvent }[]>()
const LOG_LIMIT = 2000

type Subscriber = (id: number, e: EngineEvent) => void
const subscribers = new Map<string, Set<Subscriber>>()

function publish(conversationId: string, e: EngineEvent) {
  const id = ++eventSeq
  const log = eventLog.get(conversationId) ?? []
  log.push({ id, e })
  while (log.length > LOG_LIMIT) log.shift()
  eventLog.set(conversationId, log)
  for (const fn of subscribers.get(conversationId) ?? []) fn(id, e)
}

async function buildProviders(): Promise<AIProvider[]> {
  if (MOCK) {
    return [
      new MockProvider('openai',    { reply: (_c, t) => `ChatGPT (mock) turn ${t}: I would start with PostgreSQL.`, delayMs: 40 }),
      new MockProvider('anthropic', { reply: (_c, t) => `Claude (mock) turn ${t}: agreed on Postgres, but the write pattern matters more than the engine.`, delayMs: 40 }),
    ]
  }
  const out: AIProvider[] = []

  // Two ways a provider can be authenticated, and the app must not assume the
  // first one:
  //
  //   1. A key in the environment, which the SDK reads itself.
  //   2. An egress proxy that injects the auth header on the way out, so the
  //      process never sees the credential at all. Claude Code's cloud
  //      environments offer this as "API credentials", and it is the correct
  //      place for a secret there — the plain environment-variable box in the
  //      same dialog says in as many words that its contents are visible to
  //      anyone using the environment.
  //
  // Under (2) there is no key to detect, so presence of a key cannot be the
  // test for whether a provider exists. Opt in explicitly instead, and hand the
  // SDK a placeholder so it does not refuse to construct.
  const VIA_PROXY = 'set-by-egress-proxy'

  const wantOpenAI    = !!process.env.OPENAI_API_KEY    || process.env.OPENAI_VIA_CREDENTIAL === '1'
  const wantAnthropic = !!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_VIA_CREDENTIAL === '1'

  if (wantOpenAI) {
    const { OpenAIProvider } = await import('./providers/openai.ts')
    out.push(new OpenAIProvider(process.env.OPENAI_API_KEY ?? VIA_PROXY))
  }
  if (wantAnthropic) {
    const { AnthropicProvider } = await import('./providers/anthropic.ts')
    out.push(new AnthropicProvider(process.env.ANTHROPIC_API_KEY ?? VIA_PROXY))
  }

  if (out.length === 0) {
    console.error([
      'No providers configured. Either:',
      '  • set OPENAI_API_KEY / ANTHROPIC_API_KEY, or',
      '  • store the key as an environment API credential and set',
      '    OPENAI_VIA_CREDENTIAL=1 / ANTHROPIC_VIA_CREDENTIAL=1, or',
      '  • run with --mock',
    ].join('\n'))
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

      // Every event gets an id, so a mid-generation disconnect resumes with the
      // message-start and deltas it missed rather than only finished messages.
      const since = Number(req.headers['last-event-id'] ?? 0)
      let written = since
      const write = (id: number, e: EngineEvent) => {
        if (id <= written) return          // also de-duplicates the flush below
        written = id
        res.write(`id: ${id}\ndata: ${JSON.stringify(e)}\n\n`)
      }

      // Subscribe BEFORE replaying, and buffer anything live until replay is
      // done. Subscribing afterwards left a window in which an event published
      // between the two steps reached nobody.
      let replaying = true
      const buffered: { id: number; e: EngineEvent }[] = []
      const send: Subscriber = (id, e) => {
        if (replaying) buffered.push({ id, e })
        else write(id, e)
      }
      if (!subscribers.has(cid)) subscribers.set(cid, new Set())
      subscribers.get(cid)!.add(send)

      // Synchronous on purpose — the log is in memory, so there is no await
      // here for an event to slip through.
      for (const entry of eventLog.get(cid) ?? []) write(entry.id, entry.e)
      replaying = false
      for (const entry of buffered) write(entry.id, entry.e)

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
