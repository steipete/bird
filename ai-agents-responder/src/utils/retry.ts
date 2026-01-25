/**
 * Retry utility with exponential backoff for AI Agents Twitter Auto-Responder
 */

import { logger } from '../logger.js';

/**
 * Backoff strategy type
 */
export type BackoffStrategy = 'exponential' | 'linear' | 'fixed';

/**
 * Retry options configuration
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Backoff strategy: exponential, linear, or fixed */
  backoff: BackoffStrategy;
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (caps exponential/linear growth) */
  maxDelayMs: number;
}

/**
 * Pre-configured retry configurations for different operations
 * From design.md Retry Configuration section
 */
export const RETRY_CONFIGS: Record<string, RetryOptions> = {
  birdSearch: {
    maxAttempts: 3,
    backoff: 'exponential',
    baseDelayMs: 2000,
    maxDelayMs: 8000,
  },
  birdUserLookup: {
    maxAttempts: 3,
    backoff: 'exponential',
    baseDelayMs: 2000,
    maxDelayMs: 8000,
  },
  manusPoll: {
    maxAttempts: 24, // 24 * 5s = 120s total
    backoff: 'fixed',
    baseDelayMs: 5000,
    maxDelayMs: 5000,
  },
  pngUpload: {
    maxAttempts: 2,
    backoff: 'fixed',
    baseDelayMs: 5000,
    maxDelayMs: 5000,
  },
};

/**
 * Calculate delay based on backoff strategy and attempt number
 * @param attempt - Current attempt number (0-based)
 * @param options - Retry options with backoff configuration
 * @returns Delay in milliseconds
 */
export function calculateDelay(attempt: number, options: RetryOptions): number {
  const { backoff, baseDelayMs, maxDelayMs } = options;

  let delay: number;

  switch (backoff) {
    case 'exponential':
      // delay = min(baseDelay * 2^attempt, maxDelay)
      delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      break;

    case 'linear':
      // delay = min(baseDelay * (attempt + 1), maxDelay)
      delay = Math.min(baseDelayMs * (attempt + 1), maxDelayMs);
      break;

    case 'fixed':
      // delay = baseDelay (capped at maxDelay for safety)
      delay = Math.min(baseDelayMs, maxDelayMs);
      break;

    default:
      // Fallback to fixed delay
      delay = baseDelayMs;
  }

  return delay;
}

/**
 * Sleep for specified milliseconds
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with configurable backoff strategy
 *
 * @param operation - Async function to retry
 * @param options - Retry configuration options
 * @param operationName - Name of operation for logging (optional)
 * @returns Promise resolving to operation result
 * @throws Last error after all retry attempts exhausted
 *
 * @example
 * ```typescript
 * const result = await retry(
 *   () => birdClient.search(query, count),
 *   RETRY_CONFIGS.birdSearch,
 *   'birdSearch'
 * );
 * ```
 */
export async function retry<T>(operation: () => Promise<T>, options: RetryOptions, operationName?: string): Promise<T> {
  const { maxAttempts, backoff, baseDelayMs, maxDelayMs } = options;
  const name = operationName ?? 'operation';

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Execute the operation
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we have more attempts
      const attemptsRemaining = maxAttempts - attempt - 1;

      if (attemptsRemaining > 0) {
        // Calculate delay for next retry
        const delay = calculateDelay(attempt, options);

        // Log retry attempt
        logger.warn('retry', 'retry_attempt', {
          operation: name,
          attempt: attempt + 1,
          maxAttempts,
          attemptsRemaining,
          delayMs: delay,
          backoff,
          error: lastError.message,
        });

        // Wait before next attempt
        await sleep(delay);
      } else {
        // Log final failure
        logger.error('retry', 'max_attempts_exceeded', lastError, {
          operation: name,
          totalAttempts: maxAttempts,
          backoff,
          baseDelayMs,
          maxDelayMs,
        });
      }
    }
  }

  // All attempts exhausted, throw the last error
  throw lastError ?? new Error(`${name} failed after ${maxAttempts} attempts`);
}

/**
 * Create a retry wrapper with pre-configured options
 *
 * @param options - Retry configuration options
 * @param operationName - Name of operation for logging
 * @returns Retry function with bound options
 *
 * @example
 * ```typescript
 * const retrySearch = createRetryWrapper(RETRY_CONFIGS.birdSearch, 'birdSearch');
 * const result = await retrySearch(() => birdClient.search(query, count));
 * ```
 */
export function createRetryWrapper(
  options: RetryOptions,
  operationName: string,
): <T>(operation: () => Promise<T>) => Promise<T> {
  return <T>(operation: () => Promise<T>) => retry(operation, options, operationName);
}
