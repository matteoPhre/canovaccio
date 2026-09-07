import type { SagaLogger, SagaStateStore, SagaStatus } from '../shared/types.js';

/** Configures a retry policy for a saga step. */
export interface SagaRetryPolicy {
  /** Total number of execution attempts, including the first one. */
  maxAttempts: number;
  /** Returns the delay before the next attempt. */
  backoffMs(attempt: number, error: unknown): number;
  /** Optionally adjusts a backoff delay, for example to add jitter. */
  jitterMs?(delayMs: number, attempt: number, error: unknown): number;
}

/** A unit of work and its reversing action. */
export interface OrchestratorStep<TCtx> {
  id: string;
  timeoutMs?: number;
  /** Joins this step with consecutive parallel steps in a fan-out/fan-in group. */
  parallel?: boolean;
  /** Retries failed execute attempts before compensation begins. */
  retry?: SagaRetryPolicy;
  execute(ctx: TCtx, signal: AbortSignal): Promise<void>;
  compensate(ctx: TCtx, signal: AbortSignal): Promise<void>;
}

/** Persisted state that allows an orchestrator to resume safely after a restart. */
export interface SagaOrchestrationState<TCtx> {
  context: TCtx;
  completedStepIds: string[];
  /** Steps currently running as a parallel group, retained for compensation on failure. */
  activeStepIds?: string[];
  status: SagaStatus;
}

/** Dependencies and callbacks used to create a saga orchestrator. */
export interface SagaOrchestratorOptions<TCtx> {
  id: string;
  steps: OrchestratorStep<TCtx>[];
  store: SagaStateStore<SagaOrchestrationState<TCtx>>;
  logger?: SagaLogger;
  signal?: AbortSignal;
  onStepStart?(stepId: string, ctx: TCtx): void;
  onStepEnd?(stepId: string, ctx: TCtx): void;
  onCompensating?(stepId: string, ctx: TCtx): void;
  onCompleted?(ctx: TCtx): void;
  onFailed?(error: unknown, ctx: TCtx): void;
}

/** Controls a configured sequential saga. */
export interface SagaOrchestrator<TCtx> {
  start(initialCtx: TCtx): Promise<void>;
  resume(sagaId: string): Promise<void>;
  abort(sagaId: string): Promise<void>;
}