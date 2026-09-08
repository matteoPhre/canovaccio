# @matteophre/canovaccio

Zero-dependency, TypeScript-first structure for sequential SAGA orchestration and broker-agnostic choreography. Services inject persistence, logging, event emission, and all domain behaviour.

Requires Node.js 22 or newer.

## Orchestration

```ts
import { createSagaOrchestrator, type SagaStateStore } from '@matteophre/canovaccio';

const store: SagaStateStore = serviceProvidedStore;

const orderSaga = createSagaOrchestrator({
  id: 'order-123',
  store,
  steps: [{
    id: 'reserve-inventory',
    timeoutMs: 5_000,
    async execute(order, signal) {
      await inventory.reserve(order, signal);
    },
    async compensate(order, signal) {
      await inventory.release(order, signal);
    },
  }],
});

await orderSaga.start(order);
```

## Choreography

```ts
import { defineSagaParticipant } from '@matteophre/canovaccio';

const participant = defineSagaParticipant({
  join: 'all',
  triggers: [{ event: 'inventory.reserved' }, { event: 'payment.authorized' }],
  async execute(event, ctx) {
    await ctx.emit('order.confirmed', event);
  },
  compensateTriggers: [{ event: 'payment.failed' }],
  async compensate(event, ctx) {
    await ctx.emit('order.cancelled', event);
  },
});

broker.on('inventory.reserved', (event) => participant.handle('inventory.reserved', event, {
  sagaId: event.sagaId, emit, store, logger,
}));
```

`@matteophre/canovaccio/testing` exports `InMemorySagaStateStore` for tests only.

## Parallel Steps And Retries

Consecutive steps with `parallel: true` form a fan-out/fan-in group. The next non-parallel step starts only after every step in the group succeeds. When any member fails, the orchestrator waits for the group to settle and compensates every started group member in reverse declaration order.

```ts
const orderSaga = createSagaOrchestrator({
  id: 'order-123',
  store,
  steps: [
    {
      id: 'reserve-inventory',
      parallel: true,
      retry: {
        maxAttempts: 3,
        backoffMs: (attempt) => attempt * 100,
      },
      execute: reserveInventory,
      compensate: releaseInventory,
    },
    {
      id: 'authorize-payment',
      parallel: true,
      execute: authorizePayment,
      compensate: voidPayment,
    },
    {
      id: 'confirm-order',
      execute: confirmOrder,
      compensate: cancelOrder,
    },
  ],
});
```

`maxAttempts` includes the initial execution. `backoffMs` is required when retrying; use the optional `jitterMs` callback to vary the selected delay. Retried executions receive a new merged timeout signal for each attempt.

## Recovery And Compensation

`resume(sagaId)` continues a saga from its persisted completed steps. A parallel group that was active when the process stopped has an unknown outcome, so it is never executed again automatically. Instead, `resume` compensates every active group member in reverse declaration order and rejects with `SagaRecoveryError`. Compensation handlers must therefore be idempotent.

When a compensation handler fails, the orchestrator persists `COMPENSATION_FAILED` and throws `SagaCompensationError`. Store implementations receive that terminal status as the optional third argument to `markFailed`.

## Recovery On Boot

`SagaStateStore.query()` is reserved for recovery and monitoring integrations planned for v1.x. The library does not invoke it automatically, so a service can decide when and how recovery runs during startup.

```ts
// At service startup, recover sagas in a non-terminal state.
const runningSagas = await store.query?.({ status: 'RUNNING' }) ?? [];
for (const state of runningSagas) {
  await saga.resume(state.sagaId).catch((err) => logger.error('Recovery failed', { err }));
}
```

Compensation handlers must remain idempotent: a service may need to recover a saga after an interrupted process or retry a delivery from its transport.

## Consumer-Managed Idempotency

`SagaStateStore` optionally exposes `hasProcessed` and `markProcessed`. They are intentionally not called by the library: a service decides the event identity and the transaction boundary required by its transport and persistence technology.

```ts
if (await store.hasProcessed?.(event.sagaId, event.id)) {
  return;
}

await participant.handle('payment.authorized', event, context);
await store.markProcessed?.(event.sagaId, event.id);
```

## Examples

See [examples/sequential-orchestration.ts](examples/sequential-orchestration.ts), [examples/parallel-retry-orchestration.ts](examples/parallel-retry-orchestration.ts), and [examples/choreography-and-join.ts](examples/choreography-and-join.ts) for complete, framework-agnostic usage patterns.