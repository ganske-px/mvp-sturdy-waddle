import { waitForPageReady } from '@storybook/test-runner';
import type { TestRunnerConfig } from '@storybook/test-runner';
import { toMatchImageSnapshot } from 'jest-image-snapshot';

const config: TestRunnerConfig = {
  setup() {
    // biome-ignore lint/suspicious/noExplicitAny: jest expect global injected by test-runner at runtime
    (expect as any).extend({ toMatchImageSnapshot });
  },
  async preVisit(page) {
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0ms !important;
          animation-delay: 0ms !important;
          transition-duration: 0ms !important;
          transition-delay: 0ms !important;
          caret-color: transparent !important;
        }
      `,
    });
  },
  async postVisit(page, context) {
    await waitForPageReady(page);
    const image = await page.locator('#storybook-root').screenshot();
    // biome-ignore lint/suspicious/noExplicitAny: jest expect global injected by test-runner
    (expect(image) as any).toMatchImageSnapshot({
      customSnapshotsDir: `${process.cwd()}/__snapshots__`,
      customSnapshotIdentifier: context.id,
    });
  },
};

export default config;
