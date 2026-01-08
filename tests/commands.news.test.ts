import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliContext } from '../src/cli/shared.js';
import { registerNewsCommand } from '../src/commands/news.js';

describe('news command', () => {
  let program: Command;
  let mockContext: Partial<CliContext>;

  beforeEach(() => {
    program = new Command();
    mockContext = {
      resolveTimeoutFromOptions: () => 30000,
      resolveQuoteDepthFromOptions: () => undefined,
      resolveCredentialsFromOptions: async () => ({
        cookies: {
          authToken: 'auth',
          ct0: 'ct0',
          cookieHeader: 'auth=auth; ct0=ct0',
        },
        warnings: [],
      }),
      p: (type: string) => `[${type}] `,
      colors: {
        accent: (text: string) => text,
        command: (text: string) => text,
        muted: (text: string) => text,
        section: (text: string) => text,
      },
      l: (key: string) => key,
    };
  });

  it('requires positive count value', async () => {
    registerNewsCommand(program, mockContext as CliContext);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(program.parseAsync(['node', 'bird', 'news', '--count', '0'])).rejects.toThrow('exit 1');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--count must be a positive number'));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('rejects negative count value', async () => {
    registerNewsCommand(program, mockContext as CliContext);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(program.parseAsync(['node', 'bird', 'news', '--count', '-5'])).rejects.toThrow('exit 1');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--count must be a positive number'));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('rejects non-numeric count value', async () => {
    registerNewsCommand(program, mockContext as CliContext);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(program.parseAsync(['node', 'bird', 'news', '--count', 'abc'])).rejects.toThrow('exit 1');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--count must be a positive number'));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('requires positive tweets-per-item value', async () => {
    registerNewsCommand(program, mockContext as CliContext);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(program.parseAsync(['node', 'bird', 'news', '--tweets-per-item', '0'])).rejects.toThrow('exit 1');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--tweets-per-item must be a positive number'));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('rejects negative tweets-per-item value', async () => {
    registerNewsCommand(program, mockContext as CliContext);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(program.parseAsync(['node', 'bird', 'news', '--tweets-per-item', '-3'])).rejects.toThrow('exit 1');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--tweets-per-item must be a positive number'));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('rejects non-numeric tweets-per-item value', async () => {
    registerNewsCommand(program, mockContext as CliContext);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(program.parseAsync(['node', 'bird', 'news', '--tweets-per-item', 'xyz'])).rejects.toThrow('exit 1');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--tweets-per-item must be a positive number'));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('requires both authToken and ct0 credentials', async () => {
    mockContext.resolveCredentialsFromOptions = async () => ({
      cookies: {
        authToken: '',
        ct0: '',
        cookieHeader: '',
      },
      warnings: [],
    });

    registerNewsCommand(program, mockContext as CliContext);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(program.parseAsync(['node', 'bird', 'news'])).rejects.toThrow('exit 1');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Missing required credentials'));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
