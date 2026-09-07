/** The lifecycle states a saga can occupy. */
export type SagaStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPENSATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'COMPENSATION_FAILED';

/** Persistence boundary supplied by the consuming service. */
export interface SagaStateStore<TState = unknown> {
  save(sagaId: string, state: TState): Promise<void>;
  load(sagaId: string): Promise<TState | null>;
  markCompleted(sagaId: string): Promise<void>;
  markFailed(sagaId: string, reason: unknown): Promise<void>;
  recordTrigger(sagaId: string, eventName: string, payload: unknown): Promise<void>;
  getPendingTriggers(sagaId: string): Promise<string[]>;
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