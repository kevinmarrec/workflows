import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [{
      test: {
        name: {
          label: 'filesize-diff',
          color: 'blue',
        },
        include: ['filesize-diff/src/**/*.test.ts'],
        server: {
          deps: {
            inline: ['@actions/github'],
          },
        },
      },
    }],
    reporters: ['verbose'],
    silent: 'passed-only', // Only show console output from failing tests
    coverage: {
      provider: 'v8',
      include: ['filesize-diff/src/**/*.ts'],
      exclude: ['filesize-diff/src/run.ts'],
      reporter: ['text', 'text-summary', 'json', 'json-summary'],
    },
  },
})
