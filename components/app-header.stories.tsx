import type { Meta, StoryObj } from '@storybook/nextjs';
import { AppHeader } from './app-header';

const meta = {
  title: 'App/AppHeader',
  component: AppHeader,
  parameters: {
    layout: 'fullscreen',
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/search' },
    },
  },
  decorators: [
    (Story) => (
      <div className="min-h-[200px] bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AppHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SearchActive: Story = {
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: '/search' } } },
};

export const BulkActive: Story = {
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: '/bulk' } } },
};

export const HistoryActive: Story = {
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: '/history' } } },
};

export const AuditActive: Story = {
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: '/audit' } } },
};

export const NestedActiveRoute: Story = {
  name: 'Bulk job detail (active = Bulk)',
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: '/bulk/abc-123' } },
  },
};

export const Home: Story = {
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: '/' } } },
};
