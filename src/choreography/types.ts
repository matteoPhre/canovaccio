import type { SagaEmit, SagaLogger, SagaStateStore } from '../shared/types.js';

/** Declares an event capable of triggering participant work. */
export interface SagaTrigger {
  event: string;
  required?: boolean;
}

/** Runtime dependencies supplied when an event reaches a participant. */
export interface ChoreographyContext {
  sagaId: string;
  emit: SagaEmit;
  logger: SagaLogger;
  store: SagaStateStore;
  signal?: AbortSignal;
}

/** Behaviour implemented by a service for a choreography participant. */
export interface SagaParticipantOptions<TEvent> {
  triggers: SagaTrigger[];
  join?: 'any' | 'all';
  timeoutMs?: number;
  execute(event: TEvent, ctx: ChoreographyContext): Promise<void>;
  compensateTriggers?: SagaTrigger[];
  compensate?(event: TEvent, ctx: ChoreographyContext): Promise<void>;
}

/** Handler surface wired by the consuming service to its transport. */
export interface SagaParticipant<TEvent> {
  handle(eventName: string, event: TEvent, ctx: ChoreographyContext): Promise<void>;
  handleCompensation(eventName: string, event: TEvent, ctx: ChoreographyContext): Promise<void>;
}