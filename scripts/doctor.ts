// ── npm run doctor ──────────────────────────────────────────────────────────
// Everything that can go wrong before a first real run, checked in order, with
// the actual fix printed rather than a stack trace.
//
// This exists because the adapters were written on a machine with no API keys.
// Typechecking proves the SDK calls are shaped right; it proves nothing about
// whether your account has the model named in .env. A model id taken from
// memory or a blog post is a guess. The account knows. So ask it.

const ok   = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad  = (m: string) => console.log(`  \x1b[31m✗\x1b[0m ${m}`)
const info = (m: string) => console.log(`    \x1b[2m${m}\x1b[0m`)

let failed = 0
const fail = (m: string, fix?: string) => { bad(m); if (fix) info(fix); failed++ }

console.log('\nAI Room — preflight\n')

const [maj, min] = process.versions.node.split('.').map(Number)
if (maj > 22 || (maj === 22 && min >= 6)) ok(`node ${process.versions.node}`)
else fail(`node ${process.versions.node} is too old`, 'needs 22.6+ for --experimental-strip-types')

// A provider can be authenticated by a key this process can read, OR by an
// egress proxy that injects the header and never shows us the credential. The
// second leaves nothing to detect, so it is opted into explicitly.
const VIA_PROXY = 'set-by-egress-proxy'
const openaiKey    = process.env.OPENAI_API_KEY
const anthropicKey = process.env.ANTHROPIC_API_KEY
const openaiProxy    = process.env.OPENAI_VIA_CREDENTIAL === '1'
const anthropicProxy = process.env.ANTHROPIC_VIA_CREDENTIAL === '1'

const hasOpenAI    = !!openaiKey    || openaiProxy
const hasAnthropic = !!anthropicKey || anthropicProxy

if (!hasOpenAI && !hasAnthropic) {
  fail('no providers configured',
       'set OPENAI_API_KEY / ANTHROPIC_API_KEY, or store the key as an environment\n    API credential and set OPENAI_VIA_CREDENTIAL=1 / ANTHROPIC_VIA_CREDENTIAL=1')
  console.log('\nNothing else can be checked.\n')
  process.exit(1)
}
for (const [name, key, proxy] of [['OpenAI', openaiKey, openaiProxy], ['Anthropic', anthropicKey, anthropicProxy]] as const) {
  if (key)        ok(`${name}: key in the environment`)
  else if (proxy) ok(`${name}: expecting the egress proxy to inject the credential`)
}
if (!hasOpenAI || !hasAnthropic) {
  info('only one provider — the room runs with one participant, which is supported')
}

async function checkOpenAI() {
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: openaiKey ?? VIA_PROXY })
  const want = process.env.OPENAI_MODEL ?? 'gpt-5.5'

  const ids: string[] = []
  try {
    for await (const m of await client.models.list()) ids.push(m.id)
  } catch (e: any) {
    return fail(`OpenAI: cannot list models — ${e?.message ?? e}`,
                e?.status === 401 ? 'the key is rejected; check OPENAI_API_KEY' : undefined)
  }

  const chatish = ids.filter(id => /^(gpt|o\d)/.test(id)).sort()
  if (!ids.includes(want)) {
    return fail(`OpenAI: "${want}" is not on this account`,
      `set OPENAI_MODEL in .env to one of: ${chatish.slice(0, 10).join(', ')}${chatish.length > 10 ? ' …' : ''}`)
  }
  ok(`OpenAI: "${want}" is available`)

  try {
    const t = Date.now()
    const r = await client.chat.completions.create({
      model: want, max_completion_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    })
    ok(`OpenAI: live call in ${Date.now() - t}ms — "${r.choices[0]?.message?.content?.trim() ?? ''}"`)
  } catch (e: any) {
    fail(`OpenAI: live call failed — ${e?.message ?? e}`,
         'this adapter has never run against a live endpoint; this is where that shows')
  }
}

async function checkAnthropic() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: anthropicKey ?? VIA_PROXY })
  const want = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5'

  const ids: string[] = []
  try {
    for await (const m of client.models.list()) ids.push(m.id)
  } catch (e: any) {
    return fail(`Anthropic: cannot list models — ${e?.message ?? e}`,
                e?.status === 401 ? 'the key is rejected; check ANTHROPIC_API_KEY' : undefined)
  }

  if (!ids.includes(want)) {
    return fail(`Anthropic: "${want}" is not on this account`,
      `set ANTHROPIC_MODEL in .env to one of: ${ids.slice(0, 10).join(', ')}${ids.length > 10 ? ' …' : ''}`)
  }
  ok(`Anthropic: "${want}" is available`)

  try {
    const t = Date.now()
    const r = await client.messages.create({
      model: want, max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    })
    const b = r.content.find(x => x.type === 'text')
    ok(`Anthropic: live call in ${Date.now() - t}ms — "${b?.type === 'text' ? b.text.trim() : ''}"`)
  } catch (e: any) {
    fail(`Anthropic: live call failed — ${e?.message ?? e}`,
         'this adapter has never run against a live endpoint; this is where that shows')
  }
}

if (hasOpenAI)    await checkOpenAI()
if (hasAnthropic) await checkAnthropic()

console.log()
if (failed === 0) console.log('  Ready. \x1b[1mnpm start\x1b[0m, then open http://localhost:3000\n')
else { console.log(`  ${failed} problem${failed === 1 ? '' : 's'} above. Fix and run again.\n`); process.exit(1) }
