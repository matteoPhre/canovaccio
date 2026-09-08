import { SagaCompensationError, SagaRecoveryError, SagaStepError } from './errors.js';
import type {
  OrchestratorStep,
  SagaOrchestrationState,
  SagaOrchestrator,
  SagaOrchestratorOptions,
} from './types.js';
import { mergeSignals } from '../shared/signal.js';
import { executeWithRetry } from './retry.js';

/** Creates a durable saga orchestrator with sequential and parallel step groups. */
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

    const compensationStepIds = [...new Set([
      ...state.completedStepIds,
      ...(state.activeStepIds ?? []),
    ])].reverse();
    for (const stepId of compensationStepIds) {
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
        state.activeStepIds = [];
        await persist(sagaId, state);
        await options.store.markFailed(sagaId, error, 'COMPENSATION_FAILED');
        options.logger?.error(error.message, { sagaId, stepId: step.id });
        options.onFailed?.(error, state.context);
        throw error;
      }
    }

    state.status = 'FAILED';
    state.activeStepIds = [];
    await persist(sagaId, state);
    await options.store.markFailed(sagaId, originalError, 'FAILED');
    options.onFailed?.(originalError, state.context);
    throw originalError;
  }

  async function run(sagaId: string, state: SagaOrchestrationState<TCtx>): Promise<void> {
    state.status = 'RUNNING';
    await persist(sagaId, state);

    for (const group of getExecutionGroups(options.steps, state.completedStepIds)) {
      if (group.length === 1) {
        await runSequentialStep(sagaId, state, group[0]);
      } else {
        await runParallelGroup(sagaId, state, group);
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
      const activeStepIds = state.activeStepIds;
      if (activeStepIds !== undefined && activeStepIds.length > 0) {
        await compensate(sagaId, state, new SagaRecoveryError(activeStepIds));
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

  async function runSequentialStep(
    sagaId: string,
    state: SagaOrchestrationState<TCtx>,
    step: OrchestratorStep<TCtx>,
  ): Promise<void> {
    try {
      options.onStepStart?.(step.id, state.context);
      await executeWithRetry(
        (signal) => step.execute(state.context, signal),
        step.timeoutMs,
        options.signal,
        step.retry,
      );
      state.completedStepIds.push(step.id);
      await persist(sagaId, state);
      options.onStepEnd?.(step.id, state.context);
    } catch (cause: unknown) {
      const error = new SagaStepError(step.id, cause);
      options.logger?.error(error.message, { sagaId, stepId: step.id });
      await compensate(sagaId, state, error);
    }
  }

  async function runParallelGroup(
    sagaId: string,
    state: SagaOrchestrationState<TCtx>,
    steps: OrchestratorStep<TCtx>[],
  ): Promise<void> {
    state.activeStepIds = steps.map((step) => step.id);
    await persist(sagaId, state);
    const results = await Promise.allSettled(steps.map(async (step) => {
      options.onStepStart?.(step.id, state.context);
      await executeWithRetry(
        (signal) => step.execute(state.context, signal),
        step.timeoutMs,
        options.signal,
        step.retry,
      );
      options.onStepEnd?.(step.id, state.context);
    }));
    const failureIndex = results.findIndex((result) => result.status === 'rejected');

    if (failureIndex !== -1) {
      const failure = results[failureIndex];
      if (failure.status === 'rejected') {
        const error = new SagaStepError(steps[failureIndex].id, failure.reason);
        options.logger?.error(error.message, { sagaId, stepId: steps[failureIndex].id });
        await compensate(sagaId, state, error);
      }
    }

    state.completedStepIds.push(...steps.map((step) => step.id));
    state.activeStepIds = [];
    await persist(sagaId, state);
  }
}

function getExecutionGroups<TCtx>(
  steps: OrchestratorStep<TCtx>[],
  completedStepIds: string[],
): OrchestratorStep<TCtx>[][] {
  const pendingSteps = steps.filter((step) => !completedStepIds.includes(step.id));
  const groups: OrchestratorStep<TCtx>[][] = [];

  for (const step of pendingSteps) {
    const currentGroup = groups.at(-1);
    if (step.parallel && currentGroup?.every((candidate) => candidate.parallel)) {
      currentGroup.push(step);
    } else {
      groups.push([step]);
    }
  }

  return groups;
}