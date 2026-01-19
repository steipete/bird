import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    // Exclude database, integration, and e2e tests - they use bun:sqlite/bun:test which requires Bun runtime
    // Run these separately with: bun test src/__tests__/database.test.ts src/__tests__/integration/ src/__tests__/e2e/
    exclude: ['src/__tests__/database.test.ts', 'src/__tests__/integration/**/*.test.ts', 'src/__tests__/e2e/**/*.test.ts'],
    globals: false,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@steipete/bird': '/Users/peterenestrom/zaigo/bird/src/index.ts',
    },
  },
});
