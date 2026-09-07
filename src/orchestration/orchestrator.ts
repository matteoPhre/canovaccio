import { SagaCompensationError, SagaStepError } from './errors.js';
import type {
  OrchestratorStep,
  SagaOrchestrationState,
  SagaOrchestrator,
  SagaOrchestratorOptions,
} from './types.js';
import { mergeSignals } from '../shared/signal.js';

/** Creates a durable, strictly sequential saga orchestrator. */
export function createSagaOrchestrator<TCtx>(
  options: SagaOrchestratorOptions<TCtx>,
): SagaOrchestrator<TCtx> {
  async function persist(sagaId: string, state: SagaOrchestrationState<TCtx>): Promise<void> {
    await options.store.save(sagaId, state);
  }

  async function compensate(
    sagaId: string,
    state: SagaOrchestrationState<TCtx>,
    originalError: unknown,
  ): Promise<never> {
    state.status = 'COMPENSATING';
    await persist(sagaId, state);

    for (const stepId of [...state.completedStepIds].reverse()) {
      const step = options.steps.find((candidate) => candidate.id === stepId);
      if (step === undefined) {
        continue;
      }

      try {
        options.onCompensating?.(step.id, state.context);
        await step.compensate(state.context, mergeSignals(step.timeoutMs, options.signal));
      } catch (cause: unknown) {
        const error = new SagaCompensationError(step.id, cause, originalError);
        state.status = 'COMPENSATION_FAILED';
        await persist(sagaId, state);
        await options.store.markFailed(sagaId, error);
        options.logger?.error(error.message, { sagaId, stepId: step.id });
        options.onFailed?.(error, state.context);
        throw error;
      }
    }

    state.status = 'FAILED';
    await persist(sagaId, state);
    await options.store.markFailed(sagaId, originalError);
    options.onFailed?.(originalError, state.context);
    throw originalError;
  }

  async function run(sagaId: string, state: SagaOrchestrationState<TCtx>): Promise<void> {
    state.status = 'RUNNING';
    await persist(sagaId, state);

    // TODO v0.0.2: parallel steps.
    for (const step of options.steps) {
      if (state.completedStepIds.includes(step.id)) {
        continue;
      }

      try {
        options.onStepStart?.(step.id, state.context);
        await step.execute(state.context, mergeSignals(step.timeoutMs, options.signal));
        state.completedStepIds.push(step.id);
        await persist(sagaId, state);
        options.onStepEnd?.(step.id, state.context);
      } catch (cause: unknown) {
        const error = new SagaStepError(step.id, cause);
        options.logger?.error(error.message, { sagaId, stepId: step.id });
        await compensate(sagaId, state, error);
      }
    }

    state.status = 'COMPLETED';
    await persist(sagaId, state);
    await options.store.markCompleted(sagaId);
    options.onCompleted?.(state.context);
  }

  return {
    async start(initialCtx: TCtx): Promise<void> {
      await run(options.id, {
        context: initialCtx,
        completedStepIds: [],
        status: 'PENDING',
      });
    },

    async resume(sagaId: string): Promise<void> {
      const state = await options.store.load(sagaId);
      if (state === null) {
        throw new Error(`Saga "${sagaId}" was not found`);
      }
      if (state.status === 'COMPLETED') {
        return;
      }
      await run(sagaId, state);
    },

    async abort(sagaId: string): Promise<void> {
      const state = await options.store.load(sagaId);
      if (state === null) {
        throw new Error(`Saga "${sagaId}" was not found`);
      }
      await compensate(sagaId, state, new Error(`Saga "${sagaId}" aborted`));
    },
  };
}