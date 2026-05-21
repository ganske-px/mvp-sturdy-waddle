import type { Meta, StoryObj } from '@storybook/nextjs';
import { Label } from './label';
import { Textarea } from './textarea';

const meta = {
  title: 'UI/Textarea',
  component: Textarea,
  parameters: { layout: 'centered' },
  args: { placeholder: 'Type something…' },
  decorators: [
    (Story) => (
      <div className="w-[480px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = {
  args: {
    defaultValue: '111.444.777-35\n529.982.247-25\n11.222.333/0001-81\n',
    rows: 6,
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Read-only content' },
};

export const Invalid: Story = {
  args: { 'aria-invalid': true, defaultValue: 'invalid CPF' },
};

export const WithLabel: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor="csv">CSV content</Label>
      <Textarea id="csv" rows={8} {...args} />
      <p className="text-xs text-muted-foreground">Up to 250 unique documents per job.</p>
    </div>
  ),
};

export const Monospace: Story = {
  args: {
    className: 'font-mono min-h-48',
    rows: 10,
    defaultValue: '111.444.777-35\n529.982.247-25',
  },
};
