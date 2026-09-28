# 0002 — TypeScript, run by Node directly

`node --experimental-strip-types` runs the engine and its tests with no build
step and no dev dependencies. Spec §24 asks for the fewest moving parts.

**Constraint this imposes.** Strip-only mode removes type annotations but does
not transform syntax. Unsupported: parameter properties (`constructor(private
x: T)`), enums, namespaces, and anything else requiring emit. Hit this once
already in `MockProvider`; plain fields instead.

If a future dependency forces a bundler, this goes away and nothing else
changes. Until then the test suite runs in 0.4s from a cold start.
