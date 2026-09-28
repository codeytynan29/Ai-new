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

**Weakest point — corrected by review (ADR 0009).** This originally said
multi-human rooms would force a rewrite. They would not: client-originated
events still work over POST, and SSE handles the fan-out. The decision would
actually turn on sustained bidirectional streaming or presence.

**Also corrected by review:** the resume story described here was not the one
implemented. The cursor addressed messages while the stream carried several
events per message. Fixed — see ADR 0009. Resume is still limited to one
process lifetime while the store is in memory.
