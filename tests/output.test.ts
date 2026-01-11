import { describe, expect, it } from 'vitest';
import {
  formatStatsLine,
  formatTweetUrlLine,
  hyperlink,
  labelPrefix,
  resolveOutputConfigFromArgv,
  resolveOutputConfigFromCommander,
  statusPrefix,
} from '../src/lib/output.js';

describe('output', () => {
  it('defaults to emoji + color + hyperlinks on TTY', () => {
    const cfg = resolveOutputConfigFromArgv([], {}, true);
    expect(cfg).toEqual({ plain: false, emoji: true, color: true, hyperlinks: true });
  });

  it('disables hyperlinks on non-TTY', () => {
    const cfg = resolveOutputConfigFromArgv([], {}, false);
    expect(cfg.hyperlinks).toBe(false);
  });

  it('plain disables emoji + color + hyperlinks', () => {
    const cfg = resolveOutputConfigFromArgv(['--plain'], {}, true);
    expect(cfg).toEqual({ plain: true, emoji: false, color: false, hyperlinks: false });
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
    expect(cfg).toEqual({ plain: false, emoji: true, color: false, hyperlinks: true });
  });

  it('--no-emoji switches to text prefixes', () => {
    const cfg = resolveOutputConfigFromArgv(['--no-emoji'], {}, true);
    expect(cfg.emoji).toBe(false);
    expect(statusPrefix('warn', cfg)).toBe('Warning: ');
  });

  it('commander opts override defaults', () => {
    const cfg = resolveOutputConfigFromCommander({ emoji: false, color: false }, {}, true);
    expect(cfg).toEqual({ plain: false, emoji: false, color: false, hyperlinks: true });
    expect(statusPrefix('info', cfg)).toBe('Info: ');
    expect(labelPrefix('date', cfg)).toBe('Date: ');
  });

  it('commander plain wins over emoji/color', () => {
    const cfg = resolveOutputConfigFromCommander({ plain: true, emoji: true, color: true }, {}, true);
    expect(cfg).toEqual({ plain: true, emoji: false, color: false, hyperlinks: false });
  });

  it('commander disables hyperlinks on non-TTY', () => {
    const cfg = resolveOutputConfigFromCommander({}, {}, false);
    expect(cfg.hyperlinks).toBe(false);
  });

  it('formats stats line for all modes', () => {
    const stats = { likeCount: null, retweetCount: undefined, replyCount: 2 };

    expect(formatStatsLine(stats, { plain: true, emoji: false, color: false, hyperlinks: false })).toBe(
      'likes: 0  retweets: 0  replies: 2',
    );
    expect(formatStatsLine(stats, { plain: false, emoji: false, color: false, hyperlinks: false })).toBe(
      'Likes 0  Retweets 0  Replies 2',
    );
    expect(formatStatsLine(stats, { plain: false, emoji: true, color: false, hyperlinks: false })).toBe(
      '❤️ 0  🔁 0  💬 2',
    );
  });

  it('always includes tweet URL in all modes', () => {
    const id = '1234567890';
    const url = `https://x.com/i/status/${id}`;

    expect(formatTweetUrlLine(id, { plain: true, emoji: false, color: false, hyperlinks: false })).toContain(url);
    expect(formatTweetUrlLine(id, { plain: false, emoji: false, color: false, hyperlinks: false })).toContain(url);
    expect(formatTweetUrlLine(id, { plain: false, emoji: true, color: false, hyperlinks: true })).toContain(url);
  });

  it('hyperlink returns plain text when hyperlinks disabled', () => {
    const cfg = { plain: true, emoji: false, color: false, hyperlinks: false };
    expect(hyperlink('https://x.com/test', undefined, cfg)).toBe('https://x.com/test');
  });

  it('hyperlink returns plain text on non-TTY (hyperlinks: false)', () => {
    const cfg = { plain: false, emoji: true, color: false, hyperlinks: false };
    expect(hyperlink('https://x.com/test', undefined, cfg)).toBe('https://x.com/test');
  });

  it('hyperlink wraps URL with OSC 8 escapes when hyperlinks enabled', () => {
    const cfg = { plain: false, emoji: true, color: true, hyperlinks: true };
    const result = hyperlink('https://x.com/test', undefined, cfg);
    expect(result).toContain('\x1b]8;;');
    expect(result).toContain('\x07');
  });

  it('hyperlink uses custom display text', () => {
    const cfg = { plain: false, emoji: true, color: true, hyperlinks: true };
    const result = hyperlink('https://x.com/test', 'Click here', cfg);
    expect(result).toContain('Click here');
    expect(result).toContain('\x1b]8;;https://x.com/test\x07');
  });
});
