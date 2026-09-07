/** Indicates that a saga step could not complete. */
export class SagaStepError extends Error {
  constructor(
    public readonly stepId: string,
    public readonly cause: unknown,
  ) {
    super(`Saga step "${stepId}" failed`);
    this.name = 'SagaStepError';
  }
}

/** Indicates that compensation failed after a saga step failure. */
export class SagaCompensationError extends Error {
  constructor(
    public readonly stepId: string,
    public readonly cause: unknown,
    public readonly originalError: unknown,
  ) {
    super(`Saga compensation for step "${stepId}" failed`);
    this.name = 'SagaCompensationError';
  }
}