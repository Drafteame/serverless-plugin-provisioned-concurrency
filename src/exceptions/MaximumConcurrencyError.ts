/**
 * Represents an error thrown when the maximum concurrency limit is exceeded.
 *
 * This error commonly indicates that too many operations are running concurrently and
 * the system or application enforces a limit to ensure performance or resource stability.
 *
 * @extends Error
 *
 * @param {string} message - A descriptive error message providing details about the concurrency limit breach.
 */
class MaximumConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export = MaximumConcurrencyError;
