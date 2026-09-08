/** The lifecycle states a saga can occupy. */
export type SagaStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPENSATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'COMPENSATION_FAILED';

/** The terminal failure states a saga store can persist. */
export type SagaFailureStatus = 'FAILED' | 'COMPENSATION_FAILED';

/** Persistence boundary supplied by the consuming service. */
export interface SagaStateStore<TState = unknown> {
  save(sagaId: string, state: TState): Promise<void>;
  load(sagaId: string): Promise<TState | null>;
  markCompleted(sagaId: string): Promise<void>;
  markFailed(sagaId: string, reason: unknown, status?: SagaFailureStatus): Promise<void>;
  /**
   * Records an event received for a choreography join.
   *
   * @param payload Reserved for future join strategies based on event content;
   * ignored by the built-in store.
   */
  recordTrigger(sagaId: string, eventName: string, payload: unknown): Promise<void>;
  getPendingTriggers(sagaId: string): Promise<string[]>;
  /** Reports whether the consumer has already marked an event as processed. */
  hasProcessed?(sagaId: string, eventName: string): Promise<boolean>;
  /** Marks an event as processed for consumer-managed idempotency. */
  markProcessed?(sagaId: string, eventName: string): Promise<void>;
  /** TODO v1.x: used for recovery-on-boot and monitoring. */
  query?(filter: { status?: SagaStatus }): Promise<TState[]>;
}

/** Structured logger supplied by the consuming service. */
export interface SagaLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Broker-agnostic event publisher supplied by the consuming service. */
export type SagaEmit = (eventName: string, payload: unknown) => Promise<void>;