import type { Meta, StoryObj } from '@storybook/nextjs';
import { Badge } from './badge';
import { Progress } from './progress';

const meta = {
  title: 'UI/Progress',
  component: Progress,
  parameters: { layout: 'centered' },
  args: { value: 0 },
  decorators: [
    (Story) => (
      <div className="w-[480px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { value: 0 } };
export const Partial: Story = { args: { value: 42 } };
export const Full: Story = { args: { value: 100 } };
export const Indeterminate: Story = { args: { value: null } };

export const Running: Story = {
  name: 'Job — running',
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Badge variant="info">Running</Badge>
          <span className="text-muted-foreground">62 of 100</span>
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">62%</span>
      </div>
      <Progress value={62} className="[&_[data-slot=progress-indicator]]:bg-primary" />
    </div>
  ),
};

export const Completed: Story = {
  name: 'Job — completed',
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Badge variant="success">Completed</Badge>
          <span className="text-muted-foreground">100 of 100</span>
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">100%</span>
      </div>
      <Progress value={100} className="[&_[data-slot=progress-indicator]]:bg-emerald-500" />
    </div>
  ),
};

export const Failed: Story = {
  name: 'Job — failed',
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Badge variant="destructive">Failed</Badge>
          <span className="text-muted-foreground">17 of 100 (3 errors)</span>
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">17%</span>
      </div>
      <Progress value={17} className="[&_[data-slot=progress-indicator]]:bg-destructive" />
    </div>
  ),
};
