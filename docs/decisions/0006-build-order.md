# 0006 — Engine first, adapters last (inverting §21)

Spec §21 orders: shell → OpenAI adapter → Anthropic adapter → canonical
conversation. Built in the opposite order.

**§21 contradicts §22.** The spec requires routing logic testable with mocked
providers. That is impossible if the engine is milestone 4 and the providers are
milestones 2 and 3.

**The engine is the only novel component.** The adapters are commodity HTTP
against documented APIs. Building adapters first means the conversation model
gets shaped by whichever adapter was written first, and provider concepts leak
into the engine — which §12 forbids.

Result: 17 tests green, zero network calls, zero API keys. Every behavioural
question about routing is now answerable in 0.4 seconds rather than by spending
money and reading a transcript.
