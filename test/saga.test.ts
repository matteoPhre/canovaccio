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
});