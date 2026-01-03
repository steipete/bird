import { describe, expect, it } from 'vitest';
import { extractBookmarkFolderId } from '../src/lib/extract-bookmark-folder-id.js';
import { extractListId } from '../src/lib/extract-list-id.js';
import { extractTweetId } from '../src/lib/extract-tweet-id.js';

describe('CLI utilities', () => {
  describe('extractTweetId', () => {
    it('should extract ID from x.com URL', () => {
      const url = 'https://x.com/steipete/status/1234567890123456789';
      expect(extractTweetId(url)).toBe('1234567890123456789');
    });

    it('should extract ID from twitter.com URL', () => {
      const url = 'https://twitter.com/steipete/status/1234567890123456789';
      expect(extractTweetId(url)).toBe('1234567890123456789');
    });

    it('should extract ID from URL with query params', () => {
      const url = 'https://x.com/steipete/status/1234567890123456789?s=20';
      expect(extractTweetId(url)).toBe('1234567890123456789');
    });

    it('should return ID as-is if already an ID', () => {
      const id = '1234567890123456789';
      expect(extractTweetId(id)).toBe('1234567890123456789');
    });

    it('should handle URLs with www prefix', () => {
      // Note: our regex handles this because \w+ matches any word chars after the domain
      const url = 'https://x.com/user_name/status/1234567890123456789';
      expect(extractTweetId(url)).toBe('1234567890123456789');
    });
  });

  describe('extractBookmarkFolderId', () => {
    it('should extract ID from x.com bookmarks URL', () => {
      const url = 'https://x.com/i/bookmarks/1976792203235119344';
      expect(extractBookmarkFolderId(url)).toBe('1976792203235119344');
    });

    it('should extract ID from twitter.com bookmarks URL', () => {
      const url = 'https://twitter.com/i/bookmarks/1976792203235119344';
      expect(extractBookmarkFolderId(url)).toBe('1976792203235119344');
    });

    it('should accept a numeric ID as-is', () => {
      const id = '1976792203235119344';
      expect(extractBookmarkFolderId(id)).toBe('1976792203235119344');
    });

    it('should return null for invalid values', () => {
      expect(extractBookmarkFolderId('not-an-id')).toBeNull();
    });

    it('should return null for folder_id query URLs', () => {
      const url = 'https://x.com/i/bookmarks?folder_id=1976792203235119344';
      expect(extractBookmarkFolderId(url)).toBeNull();
    });
  });

  describe('extractListId', () => {
    it('should extract ID from x.com list URL', () => {
      const url = 'https://x.com/i/lists/1234567890123456789';
      expect(extractListId(url)).toBe('1234567890123456789');
    });

    it('should extract ID from twitter.com list URL', () => {
      const url = 'https://twitter.com/i/lists/1234567890123456789';
      expect(extractListId(url)).toBe('1234567890123456789');
    });

    it('should extract ID from URL with query params', () => {
      const url = 'https://x.com/i/lists/1234567890123456789?s=20';
      expect(extractListId(url)).toBe('1234567890123456789');
    });

    it('should accept a numeric ID as-is', () => {
      const id = '1234567890123456789';
      expect(extractListId(id)).toBe('1234567890123456789');
    });

    it('should return null for invalid values', () => {
      expect(extractListId('not-an-id')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(extractListId('')).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      expect(extractListId('   ')).toBeNull();
    });

    it('should return null for short numeric IDs', () => {
      expect(extractListId('1234')).toBeNull();
    });

    it('should accept minimum 5-digit IDs', () => {
      expect(extractListId('12345')).toBe('12345');
    });

    it('should trim whitespace from input', () => {
      expect(extractListId('  1234567890123456789  ')).toBe('1234567890123456789');
    });

    it('should extract ID from URL with fragment', () => {
      const url = 'https://x.com/i/lists/1234567890123456789#section';
      expect(extractListId(url)).toBe('1234567890123456789');
    });
  });
});
