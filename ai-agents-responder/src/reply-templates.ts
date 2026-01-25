/**
 * Reply templates for Twitter responses
 * Randomized text generation to prevent spam detection
 */

import { randomInt } from 'node:crypto';

// =============================================================================
// Constants
// =============================================================================

/**
 * Array of 7 reply template variations from requirements.md
 * Each template includes {username} placeholder for personalization
 */
export const REPLY_TEMPLATES = [
  `Great insights on AI agents, @{username}! Here's a quick summary:`,
  `@{username} – I've distilled your thoughts on AI agents into a visual summary:`,
  `Excellent points on agentic AI! Summary attached @{username}:`,
  `Thanks for sharing your insights on AI agents, @{username}. Here's a visual breakdown:`,
  `Interesting perspective on AI agents! Quick summary here @{username}:`,
  `@{username} – Great take on agentic AI. I've summarized your key points:`,
  `Solid insights on AI agents. Visual summary attached, @{username}:`,
];

/**
 * Attribution suffix added to 50% of replies
 */
export const ATTRIBUTION_SUFFIX = '\n\n📊 AI analysis by Zaigo Labs';

/**
 * Twitter character limit
 */
export const MAX_TWEET_LENGTH = 280;

// =============================================================================
// ReplyTemplateManager
// =============================================================================

/**
 * Manages reply template selection and text building
 * Uses cryptographically secure randomness for template selection
 */
export class ReplyTemplateManager {
  /**
   * Select a random template using crypto.randomInt for secure randomness
   * @returns A template string with {username} placeholder
   */
  selectTemplate(): string {
    const index = randomInt(0, REPLY_TEMPLATES.length);
    return REPLY_TEMPLATES[index];
  }

  /**
   * Build the final reply text by replacing {username} and optionally adding attribution
   * @param template - Template string with {username} placeholder
   * @param username - Twitter username to insert (without @ prefix)
   * @returns Complete reply text ready for posting
   * @throws Error if resulting text exceeds 280 characters
   */
  buildReplyText(template: string, username: string): string {
    // Replace {username} placeholder
    let text = template.replace('{username}', username);

    // 50% probability: add Zaigo attribution
    // crypto.randomInt(0, 2) returns 0 or 1, so === 1 gives 50% chance
    const shouldAttribute = randomInt(0, 2) === 1;
    if (shouldAttribute) {
      text += ATTRIBUTION_SUFFIX;
    }

    // Validate total length
    if (text.length > MAX_TWEET_LENGTH) {
      throw new Error(`Reply text exceeds ${MAX_TWEET_LENGTH} chars: ${text.length} characters`);
    }

    return text;
  }
}
