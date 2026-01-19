/**
 * Structured JSON logger for AI Agents Twitter Auto-Responder
 */

import type { Logger, LogEntry } from './types.js';

/**
 * Log levels with their numeric priority (lower = more severe)
 */
const LOG_LEVELS: Record<'info' | 'warn' | 'error', number> = {
  error: 0,
  warn: 1,
  info: 2,
};

/**
 * Get the configured log level from environment
 */
function getConfiguredLogLevel(): 'info' | 'warn' | 'error' {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level === 'error' || level === 'warn' || level === 'info') {
    return level;
  }
  return 'info'; // Default to info
}

/**
 * Check if a log level should be output based on configured level
 */
function shouldLog(level: 'info' | 'warn' | 'error'): boolean {
  const configuredLevel = getConfiguredLogLevel();
  return LOG_LEVELS[level] <= LOG_LEVELS[configuredLevel];
}

/**
 * Write a log entry to stdout as JSON
 */
function writeLog(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}

/**
 * Create a structured JSON logger
 */
function createLogger(): Logger {
  return {
    info(
      component: string,
      event: string,
      metadata?: Record<string, unknown>
    ): void {
      if (!shouldLog('info')) return;

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        component,
        event,
      };

      if (metadata && Object.keys(metadata).length > 0) {
        entry.metadata = metadata;
      }

      writeLog(entry);
    },

    warn(
      component: string,
      event: string,
      metadata?: Record<string, unknown>
    ): void {
      if (!shouldLog('warn')) return;

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'warn',
        component,
        event,
      };

      if (metadata && Object.keys(metadata).length > 0) {
        entry.metadata = metadata;
      }

      writeLog(entry);
    },

    error(
      component: string,
      event: string,
      error: Error,
      metadata?: Record<string, unknown>
    ): void {
      if (!shouldLog('error')) return;

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'error',
        component,
        event,
        stack: error.stack,
      };

      if (metadata && Object.keys(metadata).length > 0) {
        entry.metadata = { ...metadata, message: error.message };
      } else {
        entry.metadata = { message: error.message };
      }

      writeLog(entry);
    },
  };
}

/**
 * Singleton logger instance
 */
export const logger: Logger = createLogger();
