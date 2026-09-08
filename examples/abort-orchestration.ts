import {
  createSagaOrchestrator,
  type SagaOrchestrationState,
} from '@matteophre/canovaccio';
import { InMemorySagaStateStore } from '@matteophre/canovaccio/testing';

interface Order {
  id: string;
}

const store = new InMemorySagaStateStore<SagaOrchestrationState<Order>>();

const saga = createSagaOrchestrator({
  id: 'order-321',
  store,
  steps: [{
    id: 'reserve-inventory',
    execute: async (order) => console.log(`Reserved inventory for ${order.id}`),
    compensate: async (order) => console.log(`Released inventory for ${order.id}`),
  }],
});

await saga.start({ id: 'order-321' });

// Calling abort on a terminal saga is safe and does not run compensation again.
await saga.abort('order-321');