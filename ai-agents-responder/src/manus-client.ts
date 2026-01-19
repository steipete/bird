/**
 * Manus API client for AI Agents Twitter Auto-Responder
 * Implements task creation, polling, and PDF download
 */

import { logger } from './logger.js';
import type { ManusTaskResponse, ManusTaskResult, PollOptions } from './types.js';

/**
 * Manus API response types for type safety
 */
interface ManusCreateTaskApiResponse {
  taskId?: string;
  task_id?: string;
  id?: string;
  taskUrl?: string;
  task_url?: string;
  shareUrl?: string;
  share_url?: string;
}

interface ManusPollTaskApiResponse {
  status?: string;
  outputUrl?: string;
  output_url?: string;
  pdfUrl?: string;
  pdf_url?: string;
  error?: string;
  message?: string;
}

const COMPONENT = 'manus-client';

/**
 * Default poll options
 */
const DEFAULT_POLL_OPTIONS: PollOptions = {
  timeoutMs: 120000, // 2 minutes
  pollIntervalMs: 5000, // 5 seconds
};

/**
 * Fetch with timeout wrapper
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Sleep utility for polling
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Manus API client
 */
export class ManusClient {
  private readonly apiKey: string;
  private readonly apiBase: string;

  constructor(apiKey?: string, apiBase: string = 'https://api.manus.ai/v1') {
    this.apiKey = apiKey || process.env.MANUS_API_KEY || '';
    this.apiBase = apiBase;
  }

  /**
   * Create a new Manus task with the given prompt
   * POSTs to Manus API with apiKey header
   * Returns ManusTaskResponse: { taskId, taskUrl, shareUrl }
   * Throws on API errors (4xx/5xx)
   */
  async createTask(prompt: string): Promise<ManusTaskResponse> {
    const url = `${this.apiBase}/tasks`;
    const startTime = Date.now();

    logger.info(COMPONENT, 'create_task_start', {
      promptLength: prompt.length,
    });

    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ prompt }),
      },
      30000, // 30s timeout for task creation
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.error(COMPONENT, 'create_task_error', new Error(errorText), {
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`Manus API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = (await response.json()) as ManusCreateTaskApiResponse;
    const taskId = data.taskId || data.task_id || data.id || '';
    const result: ManusTaskResponse = {
      taskId,
      taskUrl: data.taskUrl || data.task_url || `${this.apiBase}/tasks/${taskId}`,
      shareUrl: data.shareUrl || data.share_url || '',
    };

    logger.info(COMPONENT, 'create_task_success', {
      taskId: result.taskId,
      duration: Date.now() - startTime,
    });

    return result;
  }

  /**
   * Poll a Manus task until completion or timeout
   * Polls GET /tasks/{taskId} every 5s
   * Returns ManusTaskResult when status = 'completed'
   * Returns null on timeout (default 120s from options.timeoutMs)
   */
  async pollTask(taskId: string, options: PollOptions = DEFAULT_POLL_OPTIONS): Promise<ManusTaskResult | null> {
    const { timeoutMs, pollIntervalMs } = options;
    const url = `${this.apiBase}/tasks/${taskId}`;
    const startTime = Date.now();
    const deadline = startTime + timeoutMs;

    logger.info(COMPONENT, 'poll_task_start', {
      taskId,
      timeoutMs,
      pollIntervalMs,
    });

    while (Date.now() < deadline) {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        },
        10000, // 10s timeout per poll request
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        logger.error(COMPONENT, 'poll_task_error', new Error(errorText), {
          taskId,
          status: response.status,
          elapsed: Date.now() - startTime,
        });
        throw new Error(`Manus API error polling task: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as ManusPollTaskApiResponse;
      const status = data.status?.toLowerCase();

      if (status === 'completed') {
        const result: ManusTaskResult = {
          status: 'completed',
          outputUrl: data.outputUrl || data.output_url || data.pdfUrl || data.pdf_url,
        };

        const duration = Date.now() - startTime;
        logger.info(COMPONENT, 'poll_task_completed', {
          taskId,
          duration,
          outputUrl: result.outputUrl ? '***' : undefined,
        });

        return result;
      }

      if (status === 'failed' || status === 'cancelled') {
        const result: ManusTaskResult = {
          status: status as 'failed' | 'cancelled',
          error: data.error || data.message || `Task ${status}`,
        };

        logger.error(COMPONENT, 'poll_task_failed', new Error(result.error || 'Task failed'), {
          taskId,
          status,
          elapsed: Date.now() - startTime,
        });

        return result;
      }

      // Status is 'processing' or similar - continue polling
      logger.info(COMPONENT, 'poll_task_waiting', {
        taskId,
        status,
        elapsed: Date.now() - startTime,
        remainingMs: deadline - Date.now(),
      });

      // Wait before next poll
      await sleep(pollIntervalMs);
    }

    // Timeout reached
    logger.error(COMPONENT, 'poll_task_timeout', new Error('Polling timeout'), {
      taskId,
      timeoutMs,
      elapsed: Date.now() - startTime,
    });

    return null;
  }

  /**
   * Download PDF from the given URL
   * Fetches PDF as Uint8Array
   * Validates content-type is application/pdf
   * Throws on fetch errors
   */
  async downloadPdf(url: string): Promise<Uint8Array> {
    const startTime = Date.now();

    logger.info(COMPONENT, 'download_pdf_start', {
      url: `${url.substring(0, 50)}...`,
    });

    const response = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      },
      60000, // 60s timeout for PDF download
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.error(COMPONENT, 'download_pdf_error', new Error(errorText), {
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
    }

    // Validate content-type
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/pdf')) {
      logger.error(COMPONENT, 'download_pdf_invalid_content_type', new Error(`Invalid content-type: ${contentType}`), {
        contentType,
      });
      throw new Error(`Invalid content-type for PDF: expected application/pdf, got ${contentType}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const pdfData = new Uint8Array(arrayBuffer);

    logger.info(COMPONENT, 'download_pdf_success', {
      size: pdfData.length,
      duration: Date.now() - startTime,
    });

    return pdfData;
  }
}
