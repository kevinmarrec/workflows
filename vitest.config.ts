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
      },
    }, {
      test: {
        name: {
          label: 'gitops-render',
          color: 'green',
        },
        include: ['gitops-render/src/**/*.test.ts'],
      },
    }],
    reporters: ['verbose'],
    silent: 'passed-only', // Only show console output from failing tests
    coverage: {
      provider: 'v8',
      include: ['filesize-diff/src/**/*.ts', 'gitops-render/src/**/*.ts'],
      exclude: ['filesize-diff/src/run.ts', 'gitops-render/src/run.ts'],
      reporter: ['text', 'text-summary', 'json', 'json-summary'],
    },
  },
})
