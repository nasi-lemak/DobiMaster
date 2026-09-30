import { expect, test as base } from '@playwright/test';

export { expect };

/**
 * Every spec imports `test` from here: it fails a test that produced an uncaught page error or a
 * console.error (React reports key / controlled-input / act warnings that way) in any of its pages.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      const watch = (page: import('@playwright/test').Page) => {
        page.on('pageerror', (e) => errors.push(`${page.url()} pageerror: ${e.message}`));
        page.on('console', (m) => {
          if (m.type() !== 'error') return;
          const text = m.text();
          // A socket torn down by navigation is expected; the app falls back to polling.
          if (/WebSocket connection to .* failed/.test(text)) return;
          // Expected failed requests (e.g. the wrong-password login) are asserted by the tests themselves.
          if (/Failed to load resource: the server responded with a status of (401|409)/.test(text)) return;
          errors.push(`${page.url()} console.error: ${text}`);
        });
      };
      context.pages().forEach(watch);
      context.on('page', watch);
      await use(errors);
      expect(errors, 'console errors / uncaught exceptions').toEqual([]);
    },
    { auto: true },
  ],
});
