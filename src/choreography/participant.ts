import { SagaCompensationError, SagaStepError } from '../orchestration/errors.js';
import { mergeSignals } from '../shared/signal.js';
import type { SagaParticipant, SagaParticipantOptions, ChoreographyContext } from './types.js';

/** Defines a broker-agnostic choreography participant. */
export function defineSagaParticipant<TEvent>(
  options: SagaParticipantOptions<TEvent>,
): SagaParticipant<TEvent> {
  const isTrigger = (eventName: string, triggers: readonly { event: string }[]): boolean =>
    triggers.some((trigger) => trigger.event === eventName);

  async function execute(eventName: string, event: TEvent, ctx: ChoreographyContext): Promise<void> {
    try {
      await options.execute(event, {
        ...ctx,
        signal: mergeSignals(options.timeoutMs, ctx.signal),
      });
      await ctx.store.markCompleted(ctx.sagaId);
    } catch (cause: unknown) {
      const error = new SagaStepError(eventName, cause);
      await ctx.store.markFailed(ctx.sagaId, error);
      ctx.logger.error(error.message, { sagaId: ctx.sagaId, eventName });
      throw error;
    }
  }

  return {
    async handle(eventName: string, event: TEvent, ctx: ChoreographyContext): Promise<void> {
      if (!isTrigger(eventName, options.triggers)) {
        return;
      }

      if (options.join !== 'all') {
        await execute(eventName, event, ctx);
        return;
      }

      const trigger = options.triggers.find((candidate) => candidate.event === eventName);
      if (trigger?.required === false) {
        await execute(eventName, event, ctx);
        return;
      }

      await ctx.store.recordTrigger(ctx.sagaId, eventName, event);
      const recordedTriggers = await ctx.store.getPendingTriggers(ctx.sagaId);
      const requiredEvents = options.triggers
        .filter((candidate) => candidate.required !== false)
        .map((candidate) => candidate.event);
      const joined = requiredEvents.every((requiredEvent) => recordedTriggers.includes(requiredEvent));

      if (joined) {
        await execute(eventName, event, ctx);
      }
    },

    async handleCompensation(
      eventName: string,
      event: TEvent,
      ctx: ChoreographyContext,
    ): Promise<void> {
      if (options.compensate === undefined || !isTrigger(eventName, options.compensateTriggers ?? [])) {
        return;
      }

      try {
        await options.compensate(event, {
          ...ctx,
          signal: mergeSignals(options.timeoutMs, ctx.signal),
        });
      } catch (cause: unknown) {
        const error = new SagaCompensationError(eventName, cause, cause);
        await ctx.store.markFailed(ctx.sagaId, error);
        ctx.logger.error(error.message, { sagaId: ctx.sagaId, eventName });
        throw error;
      }
    },
  };
}