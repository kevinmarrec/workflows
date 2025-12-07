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
    }],
    reporters: ['verbose'],
    coverage: {
      include: ['filesize-diff/src/**/*.ts'],
      reporter: ['text', 'text-summary', 'json', 'json-summary'],
    },
  },
})
