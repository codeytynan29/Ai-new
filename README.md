# AI Room

A human, OpenAI's model and Claude in one shared real-time conversation. The
application routes messages between participants; the human is never the relay.

Built to *Shared Engineering Specification v0.1*. Architecture decisions and
the places this implementation disagrees with the spec are in
`docs/decisions/`.

## Status

Milestones 1–3 of the revised order (see ADR 0006). The engine, the canonical
transcript and the routing rules are complete and tested against mock
providers. **No real provider adapter exists yet, and nothing is wired to HTTP.**

```
npm test
```

17 tests, no network, no API keys, ~0.4s. All ten from spec §22, plus six
asserting decisions that would otherwise only exist in prose.

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
```

The engine contains no provider-specific logic (§12). It sees `ContextTurn[]`
going out and `ProviderEvent` coming back, and nothing else.

## Next

4. OpenAI adapter
5. Anthropic adapter
6. Streaming over SSE
7. Cancellation and error recovery end to end
8. Interface
