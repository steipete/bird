import { describe, expect, it } from 'vitest';
import { WRITE_COMMANDS } from '../src/cli/program.js';

describe('read-only mode', () => {
  it('WRITE_COMMANDS contains expected write operations', () => {
    expect(WRITE_COMMANDS.has('tweet')).toBe(true);
    expect(WRITE_COMMANDS.has('reply')).toBe(true);
    expect(WRITE_COMMANDS.has('follow')).toBe(true);
    expect(WRITE_COMMANDS.has('unfollow')).toBe(true);
    expect(WRITE_COMMANDS.has('unbookmark')).toBe(true);
  });

  it('WRITE_COMMANDS does not contain read operations', () => {
    expect(WRITE_COMMANDS.has('read')).toBe(false);
    expect(WRITE_COMMANDS.has('search')).toBe(false);
    expect(WRITE_COMMANDS.has('bookmarks')).toBe(false);
    expect(WRITE_COMMANDS.has('likes')).toBe(false);
    expect(WRITE_COMMANDS.has('home')).toBe(false);
    expect(WRITE_COMMANDS.has('news')).toBe(false);
    expect(WRITE_COMMANDS.has('whoami')).toBe(false);
    expect(WRITE_COMMANDS.has('following')).toBe(false);
    expect(WRITE_COMMANDS.has('followers')).toBe(false);
  });
});
