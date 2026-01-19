import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    globals: false,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@steipete/bird': '/Users/peterenestrom/zaigo/bird/src/index.ts',
    },
  },
});
