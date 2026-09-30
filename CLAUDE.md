# AI Room

A human, OpenAI's model and Claude in one shared real-time conversation. The
application routes messages between participants; the human is never the relay.

## Read this first, every session

Sessions do not share memory. These three files are the handoff:

- **`README.md`** — what runs, and how to run it.
- **`docs/decisions/`** — nine ADRs. Not notes: arguments, several of which
  disagree with the specification this was built to, and two of which record
  decisions their own author does not trust. Read `0009-review-response.md`
  first — it is the record of an independent review that found three real
  defects, and it says what changed and what was refused.
- **`docs/intended-use.md`** — what this is for, and specifically what it is
  not (it does not put Claude Code in the room).

## The rule that is easiest to break

Another model's output becomes another model's input, automatically, with no
human in between. That is prompt injection with a delivery mechanism and this
application is the mechanism.

`renderTurn()` in `src/engine/context.ts` fences foreign turns as untrusted
data. **Adapters must use it rather than formatting context themselves** — it is
implemented once so it cannot drift between providers. ADR 0004 also states
plainly that the fence is a mitigation and not an enforcement boundary; do not
describe it as making injection safe.

## Verification

```
npm test        21 tests, mock providers, no network, ~0.4s
npm run doctor  asks each account what models it has, then one live call each
npm run mock    the whole app with no keys
```

`doctor` exists because the adapters were written on a machine with no API keys.
A clean typecheck proves the SDK calls are shaped right and proves nothing about
whether an account has the model named in `.env`.

## Owner context

- Works from a phone most of the time; runs this on a Windows laptop in VS Code.
- Does not work from a terminal by habit. Explain commands or run them.
- This project is deliberately separate from SparkPro (the owner's main work).
  Do not import assumptions from it. The two may be connected later, on purpose,
  and that is a decision the owner makes.

## Conventions

- TypeScript run directly by Node (`--experimental-strip-types`). No build step.
  That mode strips types but does not transform syntax — no parameter
  properties, enums or namespaces. ADR 0002.
- The engine contains no provider-specific logic. It sees `ContextTurn[]` going
  out and `ProviderEvent` coming back. Keep it that way.
- Two runtime dependencies: the OpenAI and Anthropic SDKs. Adding a third needs
  a reason.
