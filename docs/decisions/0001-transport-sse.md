# 0001 — SSE, not WebSockets

Spec §15 leaves the choice open. Chose Server-Sent Events.

The only genuine real-time requirement is server → client: token deltas and
state transitions. Client → server is request/response and is adequately
served by POST.

SSE buys automatic reconnection via `Last-Event-ID`, which pairs with the `seq`
field (ADR 0003) to make resume a cursor lookup rather than a protocol. It also
survives proxies that mishandle WebSocket upgrades, and needs no library.

WebSockets would earn their place given client → server streaming, presence, or
multiple humans in one room. v0.1 has none of those.

**Reversible.** The engine emits `EngineEvent` and knows nothing about HTTP;
swapping transport does not touch it.

**Weakest point:** if multi-human rooms arrive sooner than assumed, this is the
decision that costs a rewrite of the delivery layer. Flagged for review.
