import type { Meta, StoryObj } from '@storybook/nextjs';
import { Badge } from './badge';

const meta = {
  title: 'UI/Badge',
  component: Badge,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'secondary',
        'outline',
        'muted',
        'success',
        'warning',
        'info',
        'destructive',
      ],
    },
  },
  args: { children: 'Badge' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Outline: Story = { args: { variant: 'outline' } };
export const Muted: Story = { args: { variant: 'muted' } };
export const Success: Story = { args: { variant: 'success', children: 'Clean' } };
export const Warning: Story = { args: { variant: 'warning', children: 'Found' } };
export const Info: Story = { args: { variant: 'info', children: 'Cached' } };
export const Destructive: Story = { args: { variant: 'destructive', children: 'Error' } };

export const Gallery: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="muted">Muted</Badge>
      <Badge variant="success">Clean</Badge>
      <Badge variant="warning">Found</Badge>
      <Badge variant="info">Cached</Badge>
      <Badge variant="destructive">Error</Badge>
    </div>
  ),
};

export const ItemStatuses: Story = {
  name: 'Bulk item statuses',
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="muted">Pending</Badge>
      <Badge variant="info">Processing</Badge>
      <Badge variant="warning">Processes found</Badge>
      <Badge variant="success">Clean</Badge>
      <Badge variant="destructive">Error</Badge>
    </div>
  ),
};

export const AuditActions: Story = {
  name: 'Audit action variants',
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="info">Login</Badge>
      <Badge variant="muted">Logout</Badge>
      <Badge>Single search</Badge>
      <Badge>Bulk search item</Badge>
      <Badge variant="secondary">Bulk job created</Badge>
      <Badge variant="outline">CSV export</Badge>
    </div>
  ),
};
