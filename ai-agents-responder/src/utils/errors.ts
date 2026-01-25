/**
 * Error detection utilities for AI Agents Twitter Auto-Responder
 *
 * Provides functions to identify error types for proper handling:
 * - Auth errors: 401/403 from Bird API
 * - Database errors: SQLite corruption, connection failures
 */

/**
 * HTTP status codes indicating authentication issues
 */
const _AUTH_STATUS_CODES = [401, 403];

/**
 * Keywords indicating authentication errors
 */
const AUTH_ERROR_KEYWORDS = [
  'unauthorized',
  'forbidden',
  'auth',
  'authentication',
  'invalid token',
  'expired token',
  'credentials',
  'not authenticated',
  'access denied',
  'invalid credentials',
  '401',
  '403',
];

/**
 * Keywords indicating database errors
 */
const DATABASE_ERROR_KEYWORDS = [
  'sqlite',
  'database',
  'db error',
  'sqlite_corrupt',
  'sqlite_busy',
  'sqlite_locked',
  'sqlite_ioerr',
  'sqlite_cantopen',
  'sqlite_notadb',
  'disk i/o error',
  'database is locked',
  'database disk image is malformed',
  'database or disk is full',
  'unable to open database',
  'no such table',
  'corruption',
  'corrupt',
];

/**
 * Keywords indicating critical errors that should exit the process
 */
const CRITICAL_ERROR_KEYWORDS = [
  // Auth-related (process should exit - can't operate without auth)
  'unauthorized',
  'forbidden',
  '401',
  '403',
  // Database corruption (process should exit - data integrity at risk)
  'sqlite_corrupt',
  'database disk image is malformed',
  'corruption',
  'corrupt',
  // Connection failures that are unrecoverable
  'sqlite_cantopen',
  'unable to open database',
];

/**
 * Result type for error classification
 */
export interface ErrorClassification {
  isAuth: boolean;
  isDatabase: boolean;
  isCritical: boolean;
  message: string;
}

/**
 * Extract error message from various error types
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    // Handle objects with message, error, or toString
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') {
      return obj.message;
    }
    if (typeof obj.error === 'string') {
      return obj.error;
    }
    if (typeof obj.toString === 'function') {
      const str = obj.toString();
      if (str !== '[object Object]') {
        return str;
      }
    }
  }
  return String(error);
}

/**
 * Check if a string contains any of the given keywords (case-insensitive)
 */
function containsKeyword(text: string, keywords: string[]): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some((keyword) => lowerText.includes(keyword.toLowerCase()));
}

/**
 * Check if an error indicates an authentication failure (401/403 from Bird)
 *
 * Auth errors typically occur when:
 * - Twitter cookies have expired
 * - Auth tokens are invalid or revoked
 * - Account has been suspended/locked
 *
 * @param error - Error to check (string, Error, or unknown)
 * @returns true if the error indicates an authentication problem
 */
export function isAuthError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  return containsKeyword(message, AUTH_ERROR_KEYWORDS);
}

/**
 * Check if an error indicates a database failure (corruption, connection issues)
 *
 * Database errors typically occur when:
 * - SQLite file is corrupted
 * - Disk is full
 * - File is locked by another process
 * - Database connection is lost
 *
 * @param error - Error to check (string, Error, or unknown)
 * @returns true if the error indicates a database problem
 */
export function isDatabaseError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  return containsKeyword(message, DATABASE_ERROR_KEYWORDS);
}

/**
 * Check if an error is critical and should cause the process to exit
 *
 * Critical errors include:
 * - Authentication failures (can't operate without auth)
 * - Database corruption (data integrity at risk)
 * - Unrecoverable connection failures
 *
 * @param error - Error to check (string, Error, or unknown)
 * @returns true if the error is critical and process should exit
 */
export function isCriticalError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  return containsKeyword(message, CRITICAL_ERROR_KEYWORDS);
}

/**
 * Classify an error into categories for proper handling
 *
 * @param error - Error to classify
 * @returns ErrorClassification with flags for each error type
 */
export function classifyError(error: unknown): ErrorClassification {
  const message = extractErrorMessage(error);
  return {
    isAuth: isAuthError(error),
    isDatabase: isDatabaseError(error),
    isCritical: isCriticalError(error),
    message,
  };
}

/**
 * Create a standardized result object for error cases
 *
 * @param error - The error that occurred
 * @param component - Component name for logging context
 * @returns Result object with success: false and error details
 */
export function createErrorResult<T>(error: unknown, component?: string): { success: false; error: string; data?: T } {
  const message = extractErrorMessage(error);
  const prefix = component ? `[${component}] ` : '';
  return {
    success: false,
    error: `${prefix}${message}`,
  };
}

/**
 * Wrap an async operation to return a result object instead of throwing
 *
 * @param operation - Async operation that may throw
 * @param component - Component name for error context
 * @returns Result object with success/error or success/data
 */
export async function wrapWithResult<T>(
  operation: () => Promise<T>,
  component?: string,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const data = await operation();
    return { success: true, data };
  } catch (error) {
    return createErrorResult(error, component);
  }
}
