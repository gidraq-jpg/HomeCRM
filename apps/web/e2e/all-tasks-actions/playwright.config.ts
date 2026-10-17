import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config.ts';

export default defineConfig({
  ...base,
  testDir: resolve(import.meta.dirname, '..'),
  testMatch: '**/all-tasks-actions.e2e.ts',
  globalSetup: resolve(import.meta.dirname, '../auth/support/global-setup.ts'),
  outputDir: resolve(import.meta.dirname, '../../test-results/artifacts'),
  projects: base.projects?.map((project) => ({
    ...project,
    testMatch: '**/all-tasks-actions.e2e.ts',
  })),
});
