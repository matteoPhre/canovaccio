import { describe, expect, it, vi } from 'vitest';
import {
  createSagaOrchestrator,
  defineSagaParticipant,
  type ChoreographyContext,
  type SagaOrchestrationState,
} from '../src/index.js';
import { InMemorySagaStateStore } from '../src/testing.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const emit = vi.fn(async () => undefined);

function choreographyContext(sagaId: string): ChoreographyContext {
  return { sagaId, emit, logger, store: new InMemorySagaStateStore() };
}

describe('createSagaOrchestrator', () => {
  it('completes every sequential step', async () => {
    const store = new InMemorySagaStateStore<SagaOrchestrationState<string>>();
    const executed: string[] = [];
    const orchestrator = createSagaOrchestrator({
      id: 'happy-path',
      store,
      steps: [
        { id: 'first', execute: async () => void executed.push('first'), compensate: async () => undefined },
        { id: 'second', execute: async () => void executed.push('second'), compensate: async () => undefined },
      ],
    });

    await orchestrator.start('context');

    expect(executed).toEqual(['first', 'second']);
    await expect(store.load('happy-path')).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('compensates completed steps in reverse after a failure', async () => {
    const store = new InMemorySagaStateStore<SagaOrchestrationState<undefined>>();
    const calls: string[] = [];
    const orchestrator = createSagaOrchestrator({
      id: 'failure',
      store,
      steps: [
        { id: 'first', execute: async () => void calls.push('execute:first'), compensate: async () => void calls.push('compensate:first') },
        { id: 'second', execute: async () => { throw new Error('unavailable'); }, compensate: async () => undefined },
      ],
    });

    await expect(orchestrator.start(undefined)).rejects.toMatchObject({ stepId: 'second' });
    expect(calls).toEqual(['execute:first', 'compensate:first']);
    await expect(store.load('failure')).resolves.toMatchObject({ status: 'FAILED' });
  });

  it('resumes from persisted completed steps', async () => {
    const store = new InMemorySagaStateStore<SagaOrchestrationState<string>>();
    await store.save('resume', { context: 'restored', completedStepIds: ['first'], status: 'RUNNING' });
    const executed = vi.fn(async () => undefined);
    const orchestrator = createSagaOrchestrator({
      id: 'unused-by-resume',
      store,
      steps: [
        { id: 'first', execute: async () => { throw new Error('must not rerun'); }, compensate: async () => undefined },
        { id: 'second', execute: executed, compensate: async () => undefined },
      ],
    });

    await orchestrator.resume('resume');

    expect(executed).toHaveBeenCalledOnce();
    await expect(store.load('resume')).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('aborts a slow step through its configured timeout', async () => {
    vi.useFakeTimers();
    const store = new InMemorySagaStateStore<SagaOrchestrationState<undefined>>();
    const orchestrator = createSagaOrchestrator({
      id: 'timeout',
      store,
      steps: [{
        id: 'slow',
        timeoutMs: 100,
        execute: async (_ctx, signal) => new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
        compensate: async () => undefined,
      }],
    });
    const result = orchestrator.start(undefined);

    await vi.advanceTimersByTimeAsync(100);
    await expect(result).rejects.toMatchObject({ stepId: 'slow' });
    vi.useRealTimers();
  });

  it('runs consecutive parallel steps together before continuing', async () => {
    const store = new InMemorySagaStateStore<SagaOrchestrationState<undefined>>();
    const calls: string[] = [];
    let releaseParallelSteps: (() => void) | undefined;
    const parallelStepsComplete = new Promise<void>((resolve) => {
      releaseParallelSteps = resolve;
    });
    const orchestrator = createSagaOrchestrator({
      id: 'parallel',
      store,
      steps: [
        { id: 'first', parallel: true, execute: async () => { calls.push('first'); await parallelStepsComplete; }, compensate: async () => undefined },
        { id: 'second', parallel: true, execute: async () => { calls.push('second'); await parallelStepsComplete; }, compensate: async () => undefined },
        { id: 'after-join', execute: async () => void calls.push('after-join'), compensate: async () => undefined },
      ],
    });
    const result = orchestrator.start(undefined);

    await vi.waitFor(() => expect(calls).toEqual(['first', 'second']));
    expect(calls).not.toContain('after-join');
    releaseParallelSteps?.();
    await result;

    expect(calls).toEqual(['first', 'second', 'after-join']);
  });

  it('compensates every started step in a failed parallel group', async () => {
    const store = new InMemorySagaStateStore<SagaOrchestrationState<undefined>>();
    const compensated: string[] = [];
    const orchestrator = createSagaOrchestrator({
      id: 'parallel-failure',
      store,
      steps: [
        { id: 'first', parallel: true, execute: async () => undefined, compensate: async () => void compensated.push('first') },
        { id: 'second', parallel: true, execute: async () => { throw new Error('unavailable'); }, compensate: async () => void compensated.push('second') },
      ],
    });

    await expect(orchestrator.start(undefined)).rejects.toMatchObject({ stepId: 'second' });

    expect(compensated).toEqual(['second', 'first']);
  });

  it('marks a saga as compensation failed when compensation throws', async () => {
    const store = new InMemorySagaStateStore<SagaOrchestrationState<undefined>>();
    const orchestrator = createSagaOrchestrator({
      id: 'compensation-failure',
      store,
      steps: [
        { id: 'first', execute: async () => undefined, compensate: async () => { throw new Error('cannot undo'); } },
        { id: 'second', execute: async () => { throw new Error('unavailable'); }, compensate: async () => undefined },
      ],
    });

    await expect(orchestrator.start(undefined)).rejects.toMatchObject({ stepId: 'first' });

    await expect(store.query?.({ status: 'COMPENSATION_FAILED' })).resolves.toHaveLength(1);
  });

  it('compensates an interrupted parallel group instead of executing it again on resume', async () => {
    const store = new InMemorySagaStateStore<SagaOrchestrationState<undefined>>();
    await store.save('interrupted-parallel', {
      context: undefined,
      completedStepIds: [],
      activeStepIds: ['first', 'second'],
      status: 'RUNNING',
    });
    const executed = vi.fn(async () => undefined);
    const compensated: string[] = [];
    const orchestrator = createSagaOrchestrator({
      id: 'unused-by-resume',
      store,
      steps: [
        { id: 'first', parallel: true, execute: executed, compensate: async () => void compensated.push('first') },
        { id: 'second', parallel: true, execute: executed, compensate: async () => void compensated.push('second') },
      ],
    });

    await expect(orchestrator.resume('interrupted-parallel')).rejects.toMatchObject({
      activeStepIds: ['first', 'second'],
    });

    expect(executed).not.toHaveBeenCalled();
    expect(compensated).toEqual(['second', 'first']);
    await expect(store.load('interrupted-parallel')).resolves.toMatchObject({ status: 'FAILED' });
  });

  it('retries a failed step using its injected backoff and jitter policy', async () => {
    const store = new InMemorySagaStateStore<SagaOrchestrationState<undefined>>();
    const execute = vi.fn(async () => {
      if (execute.mock.calls.length < 3) {
        throw new Error('transient');
      }
    });
    const backoffMs = vi.fn(() => 0);
    const jitterMs = vi.fn((delayMs: number) => delayMs);
    const orchestrator = createSagaOrchestrator({
      id: 'retry',
      store,
      steps: [{
        id: 'flaky',
        retry: { maxAttempts: 3, backoffMs, jitterMs },
        execute,
        compensate: async () => undefined,
      }],
    });

    await orchestrator.start(undefined);

    expect(execute).toHaveBeenCalledTimes(3);
    expect(backoffMs).toHaveBeenCalledTimes(2);
    expect(jitterMs).toHaveBeenCalledTimes(2);
  });

  it('calculates a retry backoff once when jitter is not configured', async () => {
    const store = new InMemorySagaStateStore<SagaOrchestrationState<undefined>>();
    const execute = vi.fn(async () => {
      if (execute.mock.calls.length === 1) {
        throw new Error('transient');
      }
    });
    const backoffMs = vi.fn(() => 0);
    const orchestrator = createSagaOrchestrator({
      id: 'retry-without-jitter',
      store,
      steps: [{
        id: 'flaky',
        retry: { maxAttempts: 2, backoffMs },
        execute,
        compensate: async () => undefined,
      }],
    });

    await orchestrator.start(undefined);

    expect(backoffMs).toHaveBeenCalledOnce();
  });
});

describe('defineSagaParticipant', () => {
  it('executes immediately for an OR join', async () => {
    const execute = vi.fn(async () => undefined);
    const participant = defineSagaParticipant({ triggers: [{ event: 'reserved' }], execute });

    await participant.handle('reserved', { value: 1 }, choreographyContext('or'));

    expect(execute).toHaveBeenCalledOnce();
  });

  it('waits until every required AND trigger is recorded', async () => {
    const execute = vi.fn(async () => undefined);
    const store = new InMemorySagaStateStore();
    const participant = defineSagaParticipant({
      join: 'all',
      triggers: [{ event: 'inventory' }, { event: 'payment' }],
      execute,
    });
    const context: ChoreographyContext = { sagaId: 'and', emit, logger, store };

    await participant.handle('inventory', { value: 1 }, context);
    expect(execute).not.toHaveBeenCalled();
    await participant.handle('payment', { value: 2 }, context);

    expect(execute).toHaveBeenCalledOnce();
  });

  it('runs compensation only for a declared compensation trigger', async () => {
    const compensate = vi.fn(async () => undefined);
    const participant = defineSagaParticipant({
      triggers: [{ event: 'reserved' }],
      execute: async () => undefined,
      compensateTriggers: [{ event: 'payment.failed' }],
      compensate,
    });

    await participant.handleCompensation('payment.failed', { value: 1 }, choreographyContext('compensation'));

    expect(compensate).toHaveBeenCalledOnce();
  });

  it('exposes opt-in event idempotency through the testing store', async () => {
    const store = new InMemorySagaStateStore();

    await expect(store.hasProcessed('idempotency', 'order.created')).resolves.toBe(false);
    await store.markProcessed('idempotency', 'order.created');

    await expect(store.hasProcessed('idempotency', 'order.created')).resolves.toBe(true);
  });
});