import { describe, expect, it } from 'vitest';
import {
  formatStatsLine,
  formatTweetUrlLine,
  labelPrefix,
  resolveOutputConfigFromArgv,
  resolveOutputConfigFromCommander,
  statusPrefix,
} from '../src/lib/output.js';

describe('output', () => {
  it('defaults to emoji + color on TTY', () => {
    const cfg = resolveOutputConfigFromArgv([], {}, true);
    expect(cfg).toEqual({ plain: false, emoji: true, color: true });
  });

  it('plain disables emoji + color', () => {
    const cfg = resolveOutputConfigFromArgv(['--plain'], {}, true);
    expect(cfg).toEqual({ plain: true, emoji: false, color: false });
    expect(statusPrefix('ok', cfg)).toBe('[ok] ');
    expect(labelPrefix('url', cfg)).toBe('url: ');
  });

  it('NO_COLOR disables colors by default', () => {
    const cfg = resolveOutputConfigFromArgv([], { NO_COLOR: '1' }, true);
    expect(cfg.color).toBe(false);
  });

  it('TERM=dumb disables colors by default', () => {
    const cfg = resolveOutputConfigFromArgv([], { TERM: 'dumb' }, true);
    expect(cfg.color).toBe(false);
  });

  it('--no-color disables colors', () => {
    const cfg = resolveOutputConfigFromArgv(['--no-color'], {}, true);
    expect(cfg).toEqual({ plain: false, emoji: true, color: false });
  });

  it('--no-emoji switches to text prefixes', () => {
    const cfg = resolveOutputConfigFromArgv(['--no-emoji'], {}, true);
    expect(cfg.emoji).toBe(false);
    expect(statusPrefix('warn', cfg)).toBe('Warning: ');
  });

  it('commander opts override defaults', () => {
    const cfg = resolveOutputConfigFromCommander({ emoji: false, color: false }, {}, true);
    expect(cfg).toEqual({ plain: false, emoji: false, color: false });
    expect(statusPrefix('info', cfg)).toBe('Info: ');
    expect(labelPrefix('date', cfg)).toBe('Date: ');
  });

  it('commander plain wins over emoji/color', () => {
    const cfg = resolveOutputConfigFromCommander({ plain: true, emoji: true, color: true }, {}, true);
    expect(cfg).toEqual({ plain: true, emoji: false, color: false });
  });

  it('formats stats line for all modes', () => {
    const stats = { likeCount: null, retweetCount: undefined, replyCount: 2 };

    expect(formatStatsLine(stats, { plain: true, emoji: false, color: false })).toBe(
      'likes: 0  retweets: 0  replies: 2',
    );
    expect(formatStatsLine(stats, { plain: false, emoji: false, color: false })).toBe('Likes 0  Retweets 0  Replies 2');
    expect(formatStatsLine(stats, { plain: false, emoji: true, color: false })).toBe('❤️ 0  🔁 0  💬 2');
  });

  it('always includes tweet URL in all modes', () => {
    const id = '1234567890';
    const url = `https://x.com/i/status/${id}`;

    expect(formatTweetUrlLine(id, { plain: true, emoji: false, color: false })).toContain(url);
    expect(formatTweetUrlLine(id, { plain: false, emoji: false, color: false })).toContain(url);
    expect(formatTweetUrlLine(id, { plain: false, emoji: true, color: false })).toContain(url);
  });
});
