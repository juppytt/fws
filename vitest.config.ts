import { defineConfig } from 'vitest/config';

/**
 * Two test projects:
 *   - unit: in-process Express + CLI tests under test/*.test.ts (fast)
 *   - e2e:  spawns the real `fws` daemon under test/e2e/**.e2e.test.ts (slow)
 *
 * Run all:        npm test
 * Run unit only:  npm run test:unit
 * Run e2e only:   npm run test:e2e
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/e2e/**'],
          testTimeout: 15000,
          hookTimeout: 10000,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.e2e.test.ts'],
          testTimeout: 30000,
          hookTimeout: 20000,
          // Daemon spawning + pidfiles → run files serially to avoid surprises
          fileParallelism: false,
          pool: 'forks',
        },
      },
    ],
  },
});
