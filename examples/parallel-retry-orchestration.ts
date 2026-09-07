import {
  createSagaOrchestrator,
  type SagaOrchestrationState,
} from '@matteophre/canovaccio';
import { InMemorySagaStateStore } from '@matteophre/canovaccio/testing';

interface Order {
  id: string;
}

const store = new InMemorySagaStateStore<SagaOrchestrationState<Order>>();
const retry = {
  maxAttempts: 3,
  backoffMs: (attempt: number) => attempt * 100,
  jitterMs: (delayMs: number) => delayMs,
};

const saga = createSagaOrchestrator({
  id: 'order-456',
  store,
  steps: [
    {
      id: 'reserve-inventory',
      parallel: true,
      retry,
      execute: async () => undefined,
      compensate: async () => undefined,
    },
    {
      id: 'authorize-payment',
      parallel: true,
      retry,
      execute: async () => undefined,
      compensate: async () => undefined,
    },
    {
      id: 'confirm-order',
      execute: async (order) => console.log(`Confirmed ${order.id}`),
      compensate: async () => undefined,
    },
  ],
});

await saga.start({ id: 'order-456' });