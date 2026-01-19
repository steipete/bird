/**
 * Circuit breaker pattern for Manus API failure protection
 *
 * State machine (from design.md):
 * - closed → open (3 consecutive failures)
 * - open → half-open (30 minutes elapsed)
 * - half-open → closed (1 successful request)
 * - half-open → open (any failure)
 */

import { logger } from '../logger.js';
import type { Database, CircuitBreakerState } from '../types.js';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit */
  threshold: number;
  /** Cooldown period in milliseconds before half-open */
  cooldownMs: number;
}

/**
 * Default circuit breaker configuration
 * - Opens after 3 consecutive failures
 * - Half-opens after 30 minutes cooldown
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  threshold: 3,
  cooldownMs: 30 * 60 * 1000, // 30 minutes
};

/**
 * Circuit breaker state update payload
 */
export interface CircuitBreakerUpdate {
  state?: 'closed' | 'open' | 'half-open';
  failureCount?: number;
  openedAt?: Date | null;
  lastFailureAt?: Date | null;
}

/**
 * Execute an operation with circuit breaker protection
 *
 * @param operation - Async function to execute
 * @param db - Database instance for state persistence
 * @param config - Circuit breaker configuration (optional, uses defaults)
 * @returns Operation result or null if circuit is open
 * @throws Operation errors are re-thrown after state is updated
 */
export async function executeWithCircuitBreaker<T>(
  operation: () => Promise<T>,
  db: Database,
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG
): Promise<T | null> {
  // Load current state from DB
  const currentState = await db.getCircuitBreakerState();

  // Handle OPEN state
  if (currentState.state === 'open') {
    // Check if cooldown has elapsed
    if (currentState.openedAt) {
      const elapsedMs = Date.now() - currentState.openedAt.getTime();

      if (elapsedMs >= config.cooldownMs) {
        // Transition: open → half-open
        await db.updateCircuitBreakerState({
          state: 'half-open',
        });

        logger.info('circuit_breaker', 'circuit_breaker_transition', {
          old_state: 'open',
          new_state: 'half-open',
          elapsedMs,
          cooldownMs: config.cooldownMs,
        });
      } else {
        // Still open, reject request
        const remainingMs = config.cooldownMs - elapsedMs;

        logger.warn('circuit_breaker', 'request_rejected', {
          state: 'open',
          elapsedMs,
          remainingMs,
          cooldownMs: config.cooldownMs,
        });

        return null;
      }
    } else {
      // openedAt is null but state is open - shouldn't happen, transition to half-open
      await db.updateCircuitBreakerState({
        state: 'half-open',
      });

      logger.warn('circuit_breaker', 'circuit_breaker_transition', {
        old_state: 'open',
        new_state: 'half-open',
        reason: 'missing_opened_at',
      });
    }
  }

  // Re-fetch state after potential transition
  const stateAfterTransition = await db.getCircuitBreakerState();

  try {
    // Execute the operation
    const result = await operation();

    // Success handling
    if (stateAfterTransition.state === 'half-open') {
      // Transition: half-open → closed (1 successful request)
      await db.recordManusSuccess();

      logger.info('circuit_breaker', 'circuit_breaker_transition', {
        old_state: 'half-open',
        new_state: 'closed',
        reason: 'successful_request',
      });
    } else if (stateAfterTransition.state === 'closed' && stateAfterTransition.failureCount > 0) {
      // Reset failure count on success in closed state
      await db.recordManusSuccess();

      logger.info('circuit_breaker', 'circuit_breaker_transition', {
        old_state: 'closed',
        new_state: 'closed',
        reason: 'failure_count_reset',
        previous_failure_count: stateAfterTransition.failureCount,
      });
    }

    return result;
  } catch (error) {
    // Failure handling
    const operationError = error instanceof Error ? error : new Error(String(error));
    const newFailureCount = stateAfterTransition.failureCount + 1;

    if (stateAfterTransition.state === 'half-open') {
      // Transition: half-open → open (any failure)
      const now = new Date();
      await db.updateCircuitBreakerState({
        state: 'open',
        failureCount: newFailureCount,
        openedAt: now,
        lastFailureAt: now,
      });

      logger.info('circuit_breaker', 'circuit_breaker_transition', {
        old_state: 'half-open',
        new_state: 'open',
        reason: 'failure_in_half_open',
        failure_count: newFailureCount,
        error: operationError.message,
      });
    } else if (newFailureCount >= config.threshold) {
      // Transition: closed → open (threshold reached)
      const now = new Date();
      await db.updateCircuitBreakerState({
        state: 'open',
        failureCount: newFailureCount,
        openedAt: now,
        lastFailureAt: now,
      });

      logger.info('circuit_breaker', 'circuit_breaker_transition', {
        old_state: 'closed',
        new_state: 'open',
        reason: 'threshold_reached',
        failure_count: newFailureCount,
        threshold: config.threshold,
        error: operationError.message,
      });
    } else {
      // Stay in closed state, increment failure count
      await db.recordManusFailure();

      logger.warn('circuit_breaker', 'failure_recorded', {
        state: 'closed',
        failure_count: newFailureCount,
        threshold: config.threshold,
        remaining_before_open: config.threshold - newFailureCount,
        error: operationError.message,
      });
    }

    // Re-throw the error
    throw operationError;
  }
}
