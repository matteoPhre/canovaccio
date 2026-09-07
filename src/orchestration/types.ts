import type { SagaLogger, SagaStateStore, SagaStatus } from '../shared/types.js';

/** A sequential unit of work and its reversing action. */
export interface OrchestratorStep<TCtx> {
  id: string;
  timeoutMs?: number;
  execute(ctx: TCtx, signal: AbortSignal): Promise<void>;
  compensate(ctx: TCtx, signal: AbortSignal): Promise<void>;
}

/** Persisted state that allows an orchestrator to resume safely after a restart. */
export interface SagaOrchestrationState<TCtx> {
  context: TCtx;
  completedStepIds: string[];
  status: SagaStatus;
}

/** Dependencies and callbacks used to create a sequential saga orchestrator. */
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