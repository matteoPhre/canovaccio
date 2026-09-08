import {
  defineSagaParticipant,
  type ChoreographyContext,
  type SagaEmit,
  type SagaLogger,
} from '@matteophre/canovaccio';
import { InMemorySagaStateStore } from '@matteophre/canovaccio/testing';

interface OrderEvent {
  id: string;
  sagaId: string;
}

const store = new InMemorySagaStateStore();
const logger: SagaLogger = console;
const emit: SagaEmit = async (eventName, payload) => {
  console.log(eventName, payload);
};
const participant = defineSagaParticipant<OrderEvent>({
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

async function onBrokerEvent(eventName: string, event: OrderEvent): Promise<void> {
  const ctx: ChoreographyContext = { sagaId: event.sagaId, emit, logger, store };
  if (await store.hasProcessed(event.sagaId, event.id)) {
    return;
  }
  await participant.handle(eventName, event, ctx);
  await store.markProcessed(event.sagaId, event.id);
}

await onBrokerEvent('inventory.reserved', { id: 'event-1', sagaId: 'order-789' });
await onBrokerEvent('payment.authorized', { id: 'event-2', sagaId: 'order-789' });