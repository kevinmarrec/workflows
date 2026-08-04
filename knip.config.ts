import type { KnipConfig } from 'knip'

export default {
  workspaces: {
    'filesize-diff': {
      entry: 'src/run.ts',
    },
    'gitops-render': {
      entry: 'src/run.ts',
      // Provided by the caller workflow (azure/setup-helm), never by this repo.
      ignoreBinaries: ['helm'],
    },
  },
} satisfies KnipConfig
