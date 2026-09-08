import type {
  SagaLogger,
  SagaOrchestrationState,
  SagaOrchestrator,
  SagaStateStore,
} from '@matteophre/canovaccio';

interface Order {
  id: string;
}

interface RecoverableOrderSagaState extends SagaOrchestrationState<Order> {
  sagaId: string;
}

export async function recoverRunningSagas(
  store: SagaStateStore<RecoverableOrderSagaState>,
  saga: SagaOrchestrator<Order>,
  logger: SagaLogger,
): Promise<void> {
  const runningSagas = await store.query?.({ status: 'RUNNING' }) ?? [];

  for (const state of runningSagas) {
    try {
      await saga.resume(state.sagaId);
    } catch (error: unknown) {
      logger.error('Recovery failed', { sagaId: state.sagaId, error });
    }
  }
}