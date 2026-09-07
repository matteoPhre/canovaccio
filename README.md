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