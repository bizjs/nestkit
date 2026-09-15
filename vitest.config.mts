import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    sequence: { concurrent: false },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
