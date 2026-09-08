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
  id: 'order-123',
  store,
  steps: [
    {
      id: 'reserve-inventory',
      async execute(order) {
        console.log(`Reserved inventory for ${order.id}`);
      },
      async compensate(order) {
        console.log(`Released inventory for ${order.id}`);
      },
    },
  ],
});

await saga.start({ id: 'order-123' });