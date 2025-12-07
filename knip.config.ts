import type { KnipConfig } from 'knip'

export default {
  workspaces: {
    'filesize-diff': {
      entry: 'src/run.ts',
    },
  },
} satisfies KnipConfig
