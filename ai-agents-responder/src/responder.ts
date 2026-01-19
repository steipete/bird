/**
 * Responder - Bird reply wrapper with media upload
 * Uploads PNG and posts reply to Twitter/X via Bird client
 */

import {
  TwitterClient,
  resolveCredentials,
  type TweetResult,
  type UploadMediaResult,
} from '@steipete/bird';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { ReplyTemplateManager, REPLY_TEMPLATES } from './reply-templates.js';
import type { Config, ResponderResult, TweetCandidate } from './types.js';

// =============================================================================
// Responder Class
// =============================================================================

/**
 * Handles Twitter reply posting with media upload
 * Supports dry-run mode for safe testing
 */
export class Responder {
  private client: TwitterClient | null = null;
  private config: Config;
  private templateManager: ReplyTemplateManager;
  private initialized = false;

  constructor(config?: Config) {
    this.config = config ?? loadConfig();
    this.templateManager = new ReplyTemplateManager();
  }

  /**
   * Initialize the Bird client with credentials
   * Must be called before reply() in non-dry-run mode
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // In dry-run mode, client is not needed
    if (this.config.features.dryRun) {
      logger.info('responder', 'initialized_dry_run', {
        dryRun: true,
      });
      this.initialized = true;
      return;
    }

    // Initialize Bird client
    if (this.config.bird.cookieSource) {
      logger.info('responder', 'initializing_from_browser', {
        source: this.config.bird.cookieSource,
      });

      const credentials = await resolveCredentials({
        source: this.config.bird.cookieSource,
      });

      this.client = new TwitterClient(credentials);
    } else if (this.config.bird.authToken && this.config.bird.ct0) {
      logger.info('responder', 'initializing_from_tokens', {
        authTokenPrefix: this.config.bird.authToken.substring(0, 10) + '...',
      });

      this.client = new TwitterClient({
        authToken: this.config.bird.authToken,
        ct0: this.config.bird.ct0,
      });
    } else {
      throw new Error(
        'Invalid bird configuration: must provide either cookieSource or manual tokens'
      );
    }

    this.initialized = true;
    logger.info('responder', 'initialized', {
      dryRun: false,
    });
  }

  /**
   * Reply to a tweet with PNG attachment
   *
   * Orchestrates:
   * 1. uploadMedia(png, 'image/png') via Bird
   * 2. selectTemplate() and buildReplyText()
   * 3. reply(text, tweetId, [mediaId]) via Bird
   *
   * In dry-run mode: skips Bird calls, logs payload, returns fake ID
   *
   * @param tweet - The tweet to reply to
   * @param png - PNG image data as Uint8Array
   * @returns ResponderResult with replyTweetId and templateUsed
   */
  async reply(tweet: TweetCandidate, png: Uint8Array): Promise<ResponderResult> {
    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    // Select template and build reply text
    const template = this.templateManager.selectTemplate();
    const templateIndex = REPLY_TEMPLATES.indexOf(template);
    const replyText = this.templateManager.buildReplyText(
      template,
      tweet.authorUsername
    );

    // Handle dry-run mode
    if (this.config.features.dryRun) {
      logger.info('responder', 'dry_run_skip', {
        tweetId: tweet.id,
        author: tweet.authorUsername,
        pngSize: png.byteLength,
        text: replyText,
        templateIndex,
      });

      return {
        success: true,
        replyTweetId: `DRY_RUN_${Date.now()}`,
        templateUsed: templateIndex,
      };
    }

    // Ensure client is available for non-dry-run
    if (!this.client) {
      return {
        success: false,
        error: 'Bird client not initialized',
      };
    }

    try {
      // Step 1: Upload media
      logger.info('responder', 'uploading_media', {
        tweetId: tweet.id,
        pngSize: png.byteLength,
      });

      const uploadResult: UploadMediaResult = await this.client.uploadMedia({
        data: png,
        mimeType: 'image/png',
      });

      if (!uploadResult.success || !uploadResult.mediaId) {
        logger.error('responder', 'media_upload_failed', new Error(uploadResult.error || 'Unknown error'), {
          tweetId: tweet.id,
          pngSize: png.byteLength,
        });

        return {
          success: false,
          error: `Media upload failed: ${uploadResult.error || 'Unknown error'}`,
        };
      }

      logger.info('responder', 'media_uploaded', {
        tweetId: tweet.id,
        mediaId: uploadResult.mediaId,
        pngSize: png.byteLength,
      });

      // Step 2: Post reply with media attachment
      logger.info('responder', 'posting_reply', {
        tweetId: tweet.id,
        author: tweet.authorUsername,
        mediaId: uploadResult.mediaId,
        textLength: replyText.length,
        templateIndex,
      });

      const replyResult: TweetResult = await this.client.reply(
        replyText,
        tweet.id,
        [uploadResult.mediaId]
      );

      if (!replyResult.success || !replyResult.tweetId) {
        logger.error('responder', 'reply_failed', new Error(replyResult.error || 'Unknown error'), {
          tweetId: tweet.id,
          author: tweet.authorUsername,
        });

        return {
          success: false,
          error: `Reply failed: ${replyResult.error || 'Unknown error'}`,
        };
      }

      logger.info('responder', 'reply_success', {
        tweetId: tweet.id,
        author: tweet.authorUsername,
        replyTweetId: replyResult.tweetId,
        mediaId: uploadResult.mediaId,
        pngSize: png.byteLength,
        templateIndex,
      });

      return {
        success: true,
        replyTweetId: replyResult.tweetId,
        templateUsed: templateIndex,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('responder', 'reply_error', err, {
        tweetId: tweet.id,
        author: tweet.authorUsername,
      });

      return {
        success: false,
        error: err.message,
      };
    }
  }
}
