import type { SagaFailureStatus, SagaStateStore, SagaStatus } from '../shared/types.js';

/** Minimal state store for tests; production services must inject their own store. */
export class InMemorySagaStateStore<TState = unknown> implements SagaStateStore<TState> {
  private readonly states = new Map<string, TState>();
  private readonly statuses = new Map<string, SagaStatus>();
  private readonly triggers = new Map<string, Set<string>>();
  private readonly processedEvents = new Map<string, Set<string>>();

  async save(sagaId: string, state: TState): Promise<void> {
    this.states.set(sagaId, state);
  }

  async load(sagaId: string): Promise<TState | null> {
    return this.states.get(sagaId) ?? null;
  }

  async markCompleted(sagaId: string): Promise<void> {
    this.statuses.set(sagaId, 'COMPLETED');
  }

  async markFailed(
    sagaId: string,
    _reason: unknown,
    status: SagaFailureStatus = 'FAILED',
  ): Promise<void> {
    this.statuses.set(sagaId, status);
  }

  async recordTrigger(sagaId: string, eventName: string, _payload: unknown): Promise<void> {
    const sagaTriggers = this.triggers.get(sagaId) ?? new Set<string>();
    sagaTriggers.add(eventName);
    this.triggers.set(sagaId, sagaTriggers);
  }

  async getPendingTriggers(sagaId: string): Promise<string[]> {
    return [...(this.triggers.get(sagaId) ?? [])];
  }

  async hasProcessed(sagaId: string, eventName: string): Promise<boolean> {
    return this.processedEvents.get(sagaId)?.has(eventName) ?? false;
  }

  async markProcessed(sagaId: string, eventName: string): Promise<void> {
    const events = this.processedEvents.get(sagaId) ?? new Set<string>();
    events.add(eventName);
    this.processedEvents.set(sagaId, events);
  }

  /** TODO v1.x: used for recovery-on-boot and monitoring. */
  async query(filter: { status?: SagaStatus }): Promise<TState[]> {
    return [...this.states.entries()]
      .filter(([sagaId]) => filter.status === undefined || this.statuses.get(sagaId) === filter.status)
      .map(([, state]) => state);
  }
}