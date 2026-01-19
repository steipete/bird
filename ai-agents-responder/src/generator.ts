/**
 * Generator - PDF generation orchestrator
 * Orchestrates Manus API for PDF creation and conversion to PNG
 */

import { logger } from './logger.js';
import { ManusClient } from './manus-client.js';
import { PdfConverter } from './pdf-converter.js';
import type { GeneratorResult, PollOptions, TweetCandidate } from './types.js';

const COMPONENT = 'generator';

/** Maximum PNG size before compression (5MB) */
const MAX_PNG_SIZE = 5 * 1024 * 1024;

/** Default poll options for Manus task polling */
const DEFAULT_POLL_OPTIONS: PollOptions = {
  pollIntervalMs: 5000,
  timeoutMs: 120000,
};

/**
 * Build the Manus prompt from a tweet candidate
 * Uses the complete prompt template from design.md
 *
 * @param tweet - Tweet candidate to summarize
 * @returns Formatted prompt string for Manus API
 */
export function buildManusPrompt(tweet: TweetCandidate): string {
  return `Create a SINGLE-PAGE executive summary of the following X/Twitter post about AI agents.

TWEET AUTHOR: @${tweet.authorUsername} (${tweet.authorId})
TWEET CONTENT:
${tweet.text}

CRITICAL REQUIREMENTS:
- EXACTLY ONE PAGE (no multi-page output - this is non-negotiable)
- Professional Zaigo Labs branding in footer (subtle, not dominating)
- Clean, scannable layout with clear visual hierarchy
- Key points highlighted with bullets or callouts
- If applicable, extract actionable insights or predictions
- Optimized for conversion to PNG at 1200px width (high contrast, readable fonts)

FORMATTING GUIDELINES:
- Use clear section headers (e.g., "Overview", "Key Points", "Insights")
- Generous white space for readability
- High-contrast text (dark on light background)
- Minimum 12pt font for body text, 16pt for headers
- Bullet points for key takeaways
- Footer: "AI Analysis by Zaigo Labs | zaigo.ai" (small, bottom-right)

CONTENT FOCUS:
- Summarize the core message in 2-3 sentences at top
- Extract 3-5 key points or arguments
- Identify any novel insights or predictions
- If tweet discusses specific AI agent frameworks/tools, highlight them
- Maintain professional, neutral tone

OUTPUT: Single-page PDF optimized for PNG conversion.`;
}

/**
 * PDF generation orchestrator
 * Manages the full pipeline: Manus prompt -> task -> PDF -> PNG
 */
export class Generator {
  private readonly manusClient: ManusClient;
  private readonly pdfConverter: PdfConverter;
  private readonly pollOptions: PollOptions;

  constructor(manusClient?: ManusClient, pdfConverter?: PdfConverter, pollOptions?: PollOptions) {
    this.manusClient = manusClient || new ManusClient();
    this.pdfConverter = pdfConverter || new PdfConverter();
    this.pollOptions = pollOptions || DEFAULT_POLL_OPTIONS;
  }

  /**
   * Generate a PNG summary image from a tweet
   *
   * Pipeline:
   * 1. Build Manus prompt from tweet
   * 2. Create Manus task
   * 3. Poll for task completion
   * 4. Download PDF when complete
   * 5. Convert PDF to PNG
   * 6. Compress PNG if >5MB
   *
   * @param tweet - Tweet candidate to summarize
   * @returns GeneratorResult with PNG buffer or error
   */
  async generate(tweet: TweetCandidate): Promise<GeneratorResult> {
    const startTime = Date.now();
    let taskId: string | undefined;

    try {
      // Stage 1: Build Manus prompt
      const prompt = buildManusPrompt(tweet);
      logger.info(COMPONENT, 'prompt_built', {
        tweetId: tweet.id,
        authorUsername: tweet.authorUsername,
        promptLength: prompt.length,
      });

      // Stage 2: Create Manus task
      const taskResponse = await this.manusClient.createTask(prompt);
      taskId = taskResponse.taskId;
      logger.info(COMPONENT, 'task_created', {
        tweetId: tweet.id,
        taskId,
        taskUrl: taskResponse.taskUrl,
      });

      // Stage 3: Poll for task completion
      logger.info(COMPONENT, 'polling_started', {
        tweetId: tweet.id,
        taskId,
        timeoutMs: this.pollOptions.timeoutMs,
        pollIntervalMs: this.pollOptions.pollIntervalMs,
      });

      const taskResult = await this.manusClient.pollTask(taskId, this.pollOptions);

      // Handle poll timeout
      if (taskResult === null) {
        const duration = Date.now() - startTime;
        logger.error(COMPONENT, 'generation_timeout', new Error('Manus task polling timed out'), {
          tweetId: tweet.id,
          taskId,
          duration,
          timeoutMs: this.pollOptions.timeoutMs,
        });
        return {
          success: false,
          error: `Manus task timed out after ${this.pollOptions.timeoutMs}ms`,
          manusTaskId: taskId,
          manusDuration: duration,
        };
      }

      // Handle failed/cancelled task
      if (taskResult.status === 'failed' || taskResult.status === 'cancelled') {
        const duration = Date.now() - startTime;
        logger.error(COMPONENT, 'task_failed', new Error(taskResult.error || 'Task failed'), {
          tweetId: tweet.id,
          taskId,
          status: taskResult.status,
          duration,
        });
        return {
          success: false,
          error: taskResult.error || `Manus task ${taskResult.status}`,
          manusTaskId: taskId,
          manusDuration: duration,
        };
      }

      // Handle missing PDF URL
      if (!taskResult.outputUrl) {
        const duration = Date.now() - startTime;
        logger.error(COMPONENT, 'no_pdf_url', new Error('No PDF URL in completed task'), {
          tweetId: tweet.id,
          taskId,
          duration,
        });
        return {
          success: false,
          error: 'Manus task completed but no PDF URL returned',
          manusTaskId: taskId,
          manusDuration: duration,
        };
      }

      // Stage 4: Download PDF
      const pdfBuffer = await this.manusClient.downloadPdf(taskResult.outputUrl);
      logger.info(COMPONENT, 'pdf_downloaded', {
        tweetId: tweet.id,
        taskId,
        pdfSize: pdfBuffer.length,
      });

      // Stage 5: Convert PDF to PNG
      let pngBuffer = await this.pdfConverter.convertToPng(pdfBuffer, {
        width: 1200,
        dpi: 150,
        quality: 90,
      });
      logger.info(COMPONENT, 'png_converted', {
        tweetId: tweet.id,
        taskId,
        pngSize: pngBuffer.length,
      });

      // Stage 6: Compress if needed
      if (pngBuffer.length > MAX_PNG_SIZE) {
        logger.info(COMPONENT, 'compressing_png', {
          tweetId: tweet.id,
          taskId,
          currentSize: pngBuffer.length,
          maxSize: MAX_PNG_SIZE,
        });
        pngBuffer = await this.pdfConverter.compress(pngBuffer, 80);
        logger.info(COMPONENT, 'compression_complete', {
          tweetId: tweet.id,
          taskId,
          compressedSize: pngBuffer.length,
        });
      }

      const duration = Date.now() - startTime;
      logger.info(COMPONENT, 'generation_complete', {
        tweetId: tweet.id,
        taskId,
        pngSize: pngBuffer.length,
        duration,
      });

      return {
        success: true,
        png: pngBuffer,
        manusTaskId: taskId,
        manusDuration: duration,
        pngSize: pngBuffer.length,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      logger.error(COMPONENT, 'generation_error', err, {
        tweetId: tweet.id,
        taskId,
        duration,
      });

      return {
        success: false,
        error: err.message,
        manusTaskId: taskId,
        manusDuration: duration,
      };
    }
  }
}
