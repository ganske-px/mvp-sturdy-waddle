import type { Meta, StoryObj } from '@storybook/nextjs';
import { UserForm, type UserFormValues } from './user-form';

const empty: UserFormValues = {
  email: '',
  display_name: '',
  role: 'operator',
  permissions: [],
  password: '',
};

const meta = {
  title: 'Admin/UserForm',
  component: UserForm,
  args: { onSubmit: async () => undefined },
} satisfies Meta<typeof UserForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CreateOperator: Story = {
  args: { mode: 'create', initial: empty },
};

export const CreateAdmin: Story = {
  args: { mode: 'create', initial: { ...empty, role: 'admin' } },
};

export const EditOperator: Story = {
  args: {
    mode: 'edit',
    initial: {
      email: 'maria@example.com',
      display_name: 'Maria',
      role: 'operator',
      permissions: ['search_person'],
    },
  },
};

export const EditLastAdmin: Story = {
  args: {
    mode: 'edit',
    isLastActiveAdmin: true,
    initial: {
      email: 'admin@example.com',
      display_name: 'Admin',
      role: 'admin',
      permissions: [],
    },
  },
};
