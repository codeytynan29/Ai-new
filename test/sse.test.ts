// ── SSE reconnect ───────────────────────────────────────────────────────────
// Review found that the stream's cursor addressed MESSAGES while the stream
// carried several events per message. Only message-end got an id, so a client
// that dropped mid-generation resumed having missed the message-start and every
// delta — and replay re-sent still-streaming messages labelled message-end,
// telling the browser a turn had finished while it was still being written.
//
// Boots the real server with mock providers and reconnects for real.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'

const PORT = 3456
const BASE = `http://localhost:${PORT}`

function startServer(): Promise<ChildProcess> {
  const p = spawn('node', ['--experimental-strip-types', 'src/server.ts', '--mock'], {
    env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000)
    p.stdout!.on('data', d => {
      if (String(d).includes('AI Room on')) { clearTimeout(t); resolve(p) }
    })
    p.on('error', reject)
  })
}

/** Read an SSE stream for `ms`, returning every `id: N / data: {...}` pair. */
async function listen(url: string, ms: number, lastEventId?: string) {
  const ac = new AbortController()
  const headers: Record<string, string> = {}
  if (lastEventId) headers['last-event-id'] = lastEventId
  const res = await fetch(url, { headers, signal: ac.signal })
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  const out: { id: number; type: string; raw: any }[] = []
  let buf = ''
  const done = new Promise<void>(r => setTimeout(() => { ac.abort(); r() }, ms))
  ;(async () => {
    try {
      for (;;) {
        const { value, done: fin } = await reader.read()
        if (fin) break
        buf += dec.decode(value, { stream: true })
        const frames = buf.split('\n\n'); buf = frames.pop() ?? ''
        for (const f of frames) {
          const id = /^id: (\d+)$/m.exec(f)?.[1]
          const data = /^data: (.*)$/m.exec(f)?.[1]
          if (id && data) { const raw = JSON.parse(data); out.push({ id: Number(id), type: raw.type, raw }) }
        }
      }
    } catch { /* aborted */ }
  })()
  await done
  return out
}

test('SSE: every event carries an id, and a reconnect resumes from it', async (t) => {
  const srv = await startServer()
  t.after(() => srv.kill())

  const conv = (await (await fetch(`${BASE}/api/conversations`, { method: 'POST' })).json()).conversation.id

  // Watch the whole exchange.
  const watching = listen(`${BASE}/api/conversations/${conv}/events`, 3500)
  await new Promise(r => setTimeout(r, 200))
  await fetch(`${BASE}/api/conversations/${conv}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'which database?', mode: 'both' }),
  })
  const all = await watching

  assert.ok(all.length > 5, `saw ${all.length} events`)
  assert.ok(all.every(e => Number.isInteger(e.id) && e.id > 0), 'every event has an id')

  const kinds = new Set(all.map(e => e.type))
  assert.ok(kinds.has('message-start'), 'message-start is in the stream')
  assert.ok(kinds.has('message-delta'), 'deltas are in the stream')
  assert.ok(kinds.has('message-end'),   'message-end is in the stream')

  // Ids strictly increase, so Last-Event-ID is a usable cursor.
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i].id > all[i - 1].id, 'ids strictly increase')
  }

  // Resume from a point in the MIDDLE of generation and demand the events a
  // message-only cursor would have skipped.
  const mid = all[Math.floor(all.length / 2)].id
  const resumed = await listen(`${BASE}/api/conversations/${conv}/events`, 900, String(mid))

  assert.ok(resumed.length > 0, 'the reconnect replayed something')
  assert.ok(resumed.every(e => e.id > mid), 'and nothing at or before the cursor')
  assert.deepEqual(
    resumed.map(e => e.id),
    all.filter(e => e.id > mid).map(e => e.id),
    'the replay is exactly the events that were missed — not just finished messages',
  )
  assert.ok(
    resumed.some(e => e.type !== 'message-end'),
    'including event types a message-addressed cursor could never have replayed',
  )
})

test('SSE: a still-streaming message is never replayed as finished', async (t) => {
  const srv = await startServer()
  t.after(() => srv.kill())

  const conv = (await (await fetch(`${BASE}/api/conversations`, { method: 'POST' })).json()).conversation.id
  await fetch(`${BASE}/api/conversations/${conv}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'go', mode: 'roundtable' }),
  })
  // Connect while generation is underway.
  await new Promise(r => setTimeout(r, 300))
  const seen = await listen(`${BASE}/api/conversations/${conv}/events`, 700, '0')

  for (const e of seen) {
    if (e.type === 'message-end') {
      assert.notEqual(e.raw.message.status, 'streaming',
        'replay never labels an unfinished message as ended')
    }
  }
})
