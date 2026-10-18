import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config.ts';

export default defineConfig({
  ...base,
  use: { ...base.use, actionTimeout: 10_000 },
  testDir: resolve(import.meta.dirname, '..'),
  testMatch: '**/full-matrix.ts',
  globalSetup: resolve(import.meta.dirname, '../auth/support/global-setup.ts'),
  outputDir: resolve(import.meta.dirname, '../../test-results/artifacts'),
  projects: base.projects
    ?.filter((project) => project.name !== 'desktop')
    .map((project) => ({
      ...project,
      testMatch: '**/full-matrix.ts',
    })),
});
