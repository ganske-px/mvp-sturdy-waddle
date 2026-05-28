import type { Meta, StoryObj } from '@storybook/nextjs';
import { type UserRow, UsersTable } from './users-table';

const rows: UserRow[] = [
  {
    id: '1',
    email: 'admin@example.com',
    display_name: 'Admin',
    role: 'admin',
    is_active: true,
    permissions: [],
    is_self: true,
  },
  {
    id: '2',
    email: 'maria@example.com',
    display_name: 'Maria',
    role: 'operator',
    is_active: true,
    permissions: ['search_person', 'search_bulk'],
    is_self: false,
  },
  {
    id: '3',
    email: 'joao@example.com',
    display_name: 'João',
    role: 'operator',
    is_active: false,
    permissions: [],
    is_self: false,
  },
];

const meta = {
  title: 'Admin/UsersTable',
  component: UsersTable,
} satisfies Meta<typeof UsersTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mixed: Story = { args: { rows } };
export const Empty: Story = { args: { rows: [] } };
