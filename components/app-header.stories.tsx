import type { Meta, StoryObj } from '@storybook/nextjs';
import type { AppUser, Service } from '@/lib/auth/permissions';
import { AppHeader } from './app-header';

const admin: AppUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  display_name: 'Admin',
  role: 'admin',
  is_active: true,
};

const operator: AppUser = {
  id: 'op-1',
  email: 'op@example.com',
  display_name: 'Operadora',
  role: 'operator',
  is_active: true,
};

const ALL_PERMS: readonly Service[] = ['search_person', 'search_company', 'search_bulk'];

const meta = {
  title: 'App/AppHeader',
  component: AppHeader,
  parameters: {
    layout: 'fullscreen',
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/search/person' },
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

export const AsAdmin: Story = {
  args: { user: admin, permissions: [] },
};

export const AsOperatorWithAll: Story = {
  args: { user: operator, permissions: ALL_PERMS },
};

export const AsOperatorWithPersonOnly: Story = {
  args: { user: operator, permissions: ['search_person'] },
};

export const AsOperatorWithoutPermissions: Story = {
  args: { user: operator, permissions: [] },
};

export const CompanyActive: Story = {
  args: { user: operator, permissions: ALL_PERMS },
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: '/search/company' } },
  },
};

export const BulkJobDetail: Story = {
  name: 'Bulk job detail (active = Lote)',
  args: { user: operator, permissions: ALL_PERMS },
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: '/bulk/abc-123' } },
  },
};
