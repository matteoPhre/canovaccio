# @matteophre/canovaccio - Roadmap

## v0.0.1 - released

MVP - core structure

- **Sequential orchestration** - steps with `execute`/`compensate`, first-class `timeoutMs`, injectable `AbortSignal`, and automatic signal merging
- **Choreography with OR and AND joins** - `defineSagaParticipant`, `handle`, `handleCompensation`, and store-backed join semantics
- **`InMemorySagaStateStore`** - separate `@matteophre/canovaccio/testing` export for tests

---

## v0.0.2 - released

Parallel steps and resilience

- **Parallel orchestration steps (fan-out/fan-in)** - consecutive `parallel: true` steps run together; failed groups compensate every started step
- **Per-step retry policy** - `maxAttempts`, injected backoff, and optional jitter with zero dependencies
- **Store idempotency helper** - optional `hasProcessed(sagaId, eventName)` and `markProcessed(sagaId, eventName)` for consumer-managed event deduplication

---

## v0.1.0 - planned

Observability and store queries

- **Store query and recovery on boot** - `query({ status: 'RUNNING' })` to resume interrupted sagas when a service starts
- **Observability adapter (OpenTelemetry)** - injected automatic spans for steps and compensation without a dependency on `@opentelemetry/api`
- **Optional saga status helper** - aggregated saga state for development and monitoring

---

## v0.2.0+ - future

Ecosystem and integrations

- **Official store adapters** - `@matteophre/canovaccio-redis` and `@matteophre/canovaccio-postgres` as separate packages with peer dependencies
- **`@matteophre/dirama` bridge** - an orchestration step that wraps a Dirama pipeline through explicit composition
- **Saga-level timeout** - a global saga deadline propagated through `AbortSignal` in addition to per-step timeouts
- **Sub-sagas** - an orchestration step that starts and awaits another saga with propagated compensation

---

> Future priorities may change as real service needs emerge.