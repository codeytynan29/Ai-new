# 0008 — node:http, not Fastify (amends 0001)

ADR 0001 said Fastify. Six routes later, it did not earn its place.

What a framework buys here is routing and body parsing. Routing is six regex
matches; body parsing is fifteen lines including the size cap §20 wants anyway.
Against that, Fastify is a dependency, a plugin model, and a second set of
conventions for anyone reading the server.

`npm install` now pulls two runtime packages: the OpenAI and Anthropic SDKs.
Nothing else. §24 asks for the fewest moving parts and this is what that looks
like when taken seriously.

**Reversible.** The server is one file and does not leak into the engine.
If auth, file uploads or many more routes arrive, swapping it in is an
afternoon.

The transport decision in 0001 — SSE over WebSockets — stands unchanged. Only
the HTTP layer beneath it changed.
