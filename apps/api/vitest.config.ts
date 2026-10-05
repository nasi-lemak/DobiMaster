import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://dobi:dobi@localhost:5432/dobimaster_test',
      START_CONFIRM_SEC: '90',
      PUSH_EXTRA_HOSTS: 'push.example',
    },
  },
});
