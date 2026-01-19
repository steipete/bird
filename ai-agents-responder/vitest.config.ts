import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    // Exclude database tests - they use bun:sqlite which requires Bun runtime
    // Run these separately with: bun test src/__tests__/database.test.ts
    exclude: ['src/__tests__/database.test.ts'],
    globals: false,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@steipete/bird': '/Users/peterenestrom/zaigo/bird/src/index.ts',
    },
  },
});
