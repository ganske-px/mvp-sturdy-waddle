import type { Meta, StoryObj } from '@storybook/nextjs';
import { HomeModules } from './home-modules';

const meta = {
  title: 'App/HomeModules',
  component: HomeModules,
} satisfies Meta<typeof HomeModules>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AsAdmin: Story = { args: { role: 'admin', permissions: [] } };

export const AsOperatorWithAll: Story = {
  args: { role: 'operator', permissions: ['search_person', 'search_company', 'search_bulk'] },
};

export const AsOperatorWithPersonOnly: Story = {
  args: { role: 'operator', permissions: ['search_person'] },
};

export const AsOperatorWithoutPermissions: Story = {
  args: { role: 'operator', permissions: [] },
};
