# AI Room

A human, OpenAI's model and Claude in one shared real-time conversation. The
application routes messages between participants; the human is never the relay.

Built to *Shared Engineering Specification v0.1*. Architecture decisions and
the places this implementation disagrees with the spec are in
`docs/decisions/`.

## Status

**v0.1 complete.** All eleven exit criteria in spec §23 are met, with one
caveat: the provider adapters have been typechecked against the real SDKs and
exercised end to end with mocks, but not yet run against live APIs — the
machine they were written on had no keys.

```
npm run mock        # the whole app, no keys needed
npm start           # with real providers, reads .env
npm test            # 17 tests, no network, ~0.4s
npm run typecheck
```

Run `npm run mock` and open http://localhost:3000 to see three participants in
one conversation without spending anything.

## Try it for real

```
cp .env.example .env     # add OPENAI_API_KEY and/or ANTHROPIC_API_KEY
npm start
```

One key is enough — a missing provider is simply absent from the room, which is
§16's "one provider being unavailable while the other remains available".

## Shape

```
src/
  types.ts                  canonical message, provider event, context turn
  store/
    ConversationStore.ts    interface (§14) — a database replaces this later
    InMemoryStore.ts        v0.1 implementation; owns seq numbering
  engine/
    engine.ts               routing, modes, cancellation, failure isolation
    context.ts              transcript → provider context; untrusted fencing
    stops.ts                turns, cost, deadline, convergence
  providers/
    mock.ts                 scripted providers for tests
    openai.ts               adapter
    anthropic.ts            adapter
  server.ts                 node:http + SSE; holds the keys
web/
  index.html                the whole interface, no build step
```

The engine contains no provider-specific logic (§12). It sees `ContextTurn[]`
going out and `ProviderEvent` coming back, and nothing else.

## Next

Nothing in v0.1's scope. Candidates, in no order:

- persistence behind the existing `ConversationStore` interface
- more than one conversation at a time (the server tracks a single active room)
- a real convergence measure — see ADR 0005, which does not trust the current one
- a third provider, which should need no engine changes (§13)
